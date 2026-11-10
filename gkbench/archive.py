"""题集、成绩 ↔ 审查存档（gkms.audition_save.v2）。命令行 `gkbench save ...` 的实现。

- export：题模板（带旧版随机种子评测的答，种子只写 exam_sha；保密种子的答不导出）和固定种子题（带固定种子运行的答；只导出开发集种子）
- check：按第 5 章核对存档，并重放能重放的答（固定种子题用编成里的种子；题模板用 exam）
"""
from __future__ import annotations

import json
from pathlib import Path

from . import problems as P
from . import save
from .runner import answer_of, read_episodes
from .verify import replay_route


def _runs_by_set(run_dirs, set_name):
    out = []
    for d in run_dirs:
        d = Path(d)
        info = json.loads((d / "run.json").read_text())
        if info.get("set") == set_name and info.get("schema") == "gkbench.run.v2":
            out.append((info, list(read_episodes(d))))
    return out


def export(set_name, run_dirs=(), *, fixed=True, templates=True, reveal_template_seeds=False):
    """返回存档列表。题模板里只放 kind=template 的运行；固定种子题里放 kind=fixed 的运行。"""
    runs = _runs_by_set(run_dirs, set_name)
    docs = []
    for p, rows in P.load_set(set_name):
        meta = dict(p["meta"])
        if templates:
            # 保密种子（template_seeds）上的答只能写 exam_sha，而它能穷举反推出种子，所以不导出
            answers = [answer_of(e, info, template=True) for info, eps in runs
                       if info.get("kind") == "template" and not info.get("template_seeds")
                       for e in eps if e["id"] == p["id"]]
            docs.append(save.make_archive(p["loadout"], meta=meta, answers=answers))
        if fixed:
            for r in rows:
                if r.get("split") != "dev":
                    continue                       # 测试集的固定种子题不导出（会泄露种子）
                answers = [answer_of(e, info, template=False) for info, eps in runs if info.get("kind") == "fixed"
                           for e in eps if e["id"] == p["id"] and e["seed_index"] == r["index"]]
                m = dict(meta, source={"kind": "variant", "parent": p["id"], "change": f"补上第 {r['index']} 个种子"})
                m.pop("family", None)
                doc = save.make_archive(dict(p["loadout"], seed=r["seed"]), check=r["check"], meta=m, answers=answers)
                assert doc["id"] == r["fixed_id"]
                docs.append(doc)
    return docs


def load_docs(path):
    text = Path(path).expanduser().read_text()
    s = text.strip()
    try:
        return [json.loads(s)]
    except json.JSONDecodeError:
        return [json.loads(line) for line in text.splitlines() if line.strip()]


def check(doc, replay_answers=True):
    """返回 (报告行列表, 是否全部通过)。"""
    lines, ok = [], True
    try:
        r = save.read(doc, engine_check=P.engine_check)
    except save.SaveError as e:
        return [f"{doc.get('id', '?')}：拒绝打开 —— {e}"], False
    kind = "题模板" if r["template"] else "固定种子题"
    lines.append(f"{r['id']}（{kind}，题族 {r['family']}）：格式、编号{'' if r['template'] else '、起点核对'}通过；答 {len(r['answers'])} 条")
    if not replay_answers:
        return lines, ok
    for i, a in enumerate(r["answers"]):
        seed = r["loadout"].get("seed", a.get("exam"))
        tag = f"  答 {i}（{a['algo']}，{a['mode']}）"
        if seed is None:
            lines.append(f"{tag}：只有 exam_sha，无法重放，标为未核对")
            continue
        rep = replay_route(r["loadout"], seed, a["route"], a.get("step_ms"))
        got = rep["score"]
        if rep["err"] and not a.get("err"):
            lines.append(f"{tag}：路线有问题 —— {rep['err']}")
            ok = False
        elif got != a["score"]:
            lines.append(f"{tag}：分数不符，存档 {a['score']:,}，重放 {got:,}")
            ok = False
        else:
            lines.append(f"{tag}：重放 {got:,} 一致")
    return lines, ok
