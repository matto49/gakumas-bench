"""题库：按审查存档格式（gkms.audition_save.v2，见 gkbench/save.py）存。

  $GKBENCH_DATA/problems/<题集>/<AS-编号>.gksave.json   题模板（编成不含 seed），公开
  $GKBENCH_DATA/private/seeds/<题集>.json               gkbench.seeds.v2：每个题模板的固定种子（私有）
      {"problems": {"<题模板编号>": [{"index", "seed", "split", "label", "fixed_id", "check"}]}}
      fixed_id 是这个种子对应的固定种子题编号（4.1），check 是它的起点核对（1.5）

系统里认题一律用题模板编号（AS-…）；同一开局的固定种子题和题模板共用题族编号（AF-…，写在 meta.family）。
题模板的 meta.tags 里约定两种标签：name:<便于人读的名字>、deck:<牌组类型>。

$GKBENCH_DATA 默认 ~/github/gakumas-bench-data，不在代码仓库里。种子只有裁判读，记录里只写下标和哈希（exam_sha）。
"""
from __future__ import annotations

import hashlib
import json
import os
import random
import re
from functools import lru_cache
from pathlib import Path

from . import save

DATA = Path(os.environ.get("GKBENCH_DATA", Path.home() / "github/gakumas-bench-data")).expanduser().resolve()
SEEDS_SCHEMA = "gkbench.seeds.v2"
seed_sha = save.seed_sha


def problems_dir(set_name):
    return DATA / "problems" / set_name


def seeds_path(set_name):
    return DATA / "private" / "seeds" / f"{set_name}.json"


def _slug(s):
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", s).strip("-")


def _random_seeds(key, n):
    rng = random.Random(int(hashlib.sha256(key.encode()).hexdigest()[:12], 16))
    return [rng.randrange(1, 2 ** 31 - 1) for _ in range(n)]


# ---------------------------------------------------------------- 需要引擎的部分：题的描述、起点核对
@lru_cache(maxsize=1)
def _idol_mechanic():
    from . import engine
    engine.setup()
    from GakumasCLI.bench.roles import IDOL_MECHANIC
    out = {}
    with open(engine.MASTER_DIR / "IdolCard.jsonl", encoding="utf-8") as f:
        for line in f:
            r = json.loads(line)
            r = r.get("decoded", r)
            out[r.get("id")] = IDOL_MECHANIC.get((r.get("examEffectType") or {}).get("name"))
    return out


def describe(loadout: dict) -> dict:
    """题模板的 meta（表 4）：stage、mechanic、turns。按引擎的规则算（timeline.stage_key、IDOL_MECHANIC）。"""
    from . import engine
    _, meta = engine.build({k: v for k, v in loadout.items() if k != "seed"}, 1)
    from GakumasCLI.scenario.timeline import stage_key
    out = {}
    st = stage_key(meta)
    if st:
        out["stage"] = st
    mech = _idol_mechanic().get(loadout.get("idol_card_id"))
    if mech:
        out["mechanic"] = mech
    if meta.get("limit_turn"):
        out["turns"] = int(meta["limit_turn"])
    return out


def check_of(loadout: dict, seed: int, prefix_actions=()) -> dict:
    """固定种子题的起点核对（1.5）：建局、执行前缀，返回到达的局面摘要。"""
    from . import engine
    s, _ = engine.build({k: v for k, v in loadout.items() if k != "seed"}, int(seed))
    for a in prefix_actions:
        s.step(tuple(a) if a[0] != "select" else ("select", list(a[1])))
    o = s.observe()
    prov = engine.provenance()
    return {"turn": int(o["turn"]), "score": int(o["score"]), "stamina": int(o["stamina"]),
            "hand": [c["produce_card_id"] for c in s.deck.hand], "rules": int(prov["rules_version"]),
            "commit": str(prov.get("gkms_commit") or "")[:12]}


def engine_check(loadout, prefix_actions):
    """给 save.read 用的 d) e)：loadout 含 seed。"""
    return check_of(loadout, loadout["seed"], prefix_actions)


# ---------------------------------------------------------------- 写题集
def seed_row(loadout: dict, index: int, seed: int, split: str, label: str) -> dict:
    lo = dict(loadout, seed=int(seed))
    return {"index": index, "seed": int(seed), "split": split, "label": label,
            "fixed_id": save.archive_id(lo), "check": check_of(loadout, seed)}


def add_problem(set_name, loadout: dict, *, name: str, source: dict, tags=(), seeds=()) -> str:
    """加一道题：写题模板，记下它的固定种子。loadout 可以带 seed（会被拿掉）。seeds：[(seed, split, label)]。"""
    lo = {k: v for k, v in loadout.items() if k != "seed" and k != "source" and not k.startswith("_")}
    meta = describe(lo)
    meta["source"] = source
    meta["tags"] = [f"name:{name}"] + [t for t in tags if t]
    doc = save.make_archive(lo, meta=meta)
    d = problems_dir(set_name)
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{doc['id']}.gksave.json").write_text(save.dumps(doc))
    rows = [seed_row(lo, i, s, sp, lb) for i, (s, sp, lb) in enumerate(seeds)]
    _merge_seeds(set_name, {doc["id"]: rows})
    return doc["id"]


def _merge_seeds(set_name, seeds):
    sp = seeds_path(set_name)
    sp.parent.mkdir(parents=True, exist_ok=True)
    old = json.loads(sp.read_text())["problems"] if sp.is_file() else {}
    old.update(seeds)
    sp.write_text(json.dumps({"schema": SEEDS_SCHEMA, "set": set_name, "problems": old}, ensure_ascii=False, indent=1))
    os.chmod(sp, 0o600)


def import_loadouts(src_dir, set_name, random_seeds=4):
    """一批 gkms.hif_loadout.v1（例如从实机存档转出来的开局）。带 seed 的，第 0 个种子记为「实机」。"""
    n = 0
    for f in sorted(Path(src_dir).expanduser().glob("*.json")):
        lo = json.loads(f.read_text())
        if lo.get("schema") != "gkms.hif_loadout.v1":
            continue
        name = _slug(f.stem.replace("-opening-decoded", "").replace("__", "-"))
        seeds = [(int(lo["seed"]), "dev", "实机")] if lo.get("seed") is not None else []
        seeds += [(s, "dev", "随机") for s in _random_seeds(name, random_seeds)]
        add_problem(set_name, lo, name=name, source={"kind": "manual", "note": f"实机开局 {f.name}"}, seeds=seeds)
        n += 1
    return problems_dir(set_name), n


def import_gkms_bench(problems_jsonl, set_name):
    """GKMS 自带的审查 benchmark（GakumasCLI/bench/problems.py build 的输出，每行一题一种子；同一配置合成一个题模板）。"""
    groups: dict[str, dict] = {}
    for line in Path(problems_jsonl).expanduser().read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        rid = str(row["id"])
        head, _, tail = rid.rpartition("/")
        key = head if tail.isdigit() else rid
        g = groups.setdefault(key, {"row": row, "seeds": []})
        seed = row.get("seed", row["loadout"].get("seed"))
        if seed is not None and int(seed) not in g["seeds"]:
            g["seeds"].append(int(seed))
    for key, g in groups.items():
        row = g["row"]
        add_problem(set_name, row["loadout"], name=_slug(key), source={"kind": "bench", "problem": key},
                    tags=[f"deck:{row['deck']}" if row.get("deck") else None],
                    seeds=[(s, "dev", "gkms") for s in g["seeds"]])
    return problems_dir(set_name), len(groups)


def import_saves(paths, set_name, verify=True):
    """导入审查存档（.gksave.json 或 JSON Lines）：题模板直接收；固定种子题收成「题模板 + 一个种子」。
    按第 5 章核对（编号、题族、起点）。不收答（答走上传）。"""
    added = []
    for p in paths:
        text = Path(p).expanduser().read_text()
        docs = [json.loads(text)] if text.lstrip().startswith("{") and "\n{" not in text.strip() else \
            [json.loads(line) for line in text.splitlines() if line.strip()]
        for doc in docs:
            r = save.read(doc, engine_check=engine_check if verify else None)
            lo = r["loadout"]
            meta = doc.get("meta") or {}
            name = next((t[5:] for t in meta.get("tags") or [] if t.startswith("name:")), r["id"])
            src = meta.get("source") or {"kind": "manual"}
            if r["template"]:
                tid = add_problem(set_name, lo, name=name, source=src, tags=[t for t in meta.get("tags") or []
                                                                             if not t.startswith("name:")])
            else:
                tid = save.archive_id({k: v for k, v in lo.items() if k != "seed"})
                tpl = problems_dir(set_name) / f"{tid}.gksave.json"
                if not tpl.is_file():
                    add_problem(set_name, lo, name=name, source={"kind": "variant", "parent": r["id"],
                                                                "change": "去掉考试种子"})
                sp = seeds_path(set_name)
                allseeds = json.loads(sp.read_text())["problems"] if sp.is_file() else {}
                rows = allseeds.get(tid, [])
                if all(x["seed"] != int(lo["seed"]) for x in rows):
                    rows.append(seed_row({k: v for k, v in lo.items() if k != "seed"}, len(rows), lo["seed"], "dev", "存档"))
                    _merge_seeds(set_name, {tid: rows})
            added.append(tid)
    return added


# ---------------------------------------------------------------- 读题集
def _tags(doc: dict, lo: dict) -> dict:
    """用于分组统计的标签：来自编成和 meta。"""
    meta = doc.get("meta") or {}
    t = {"idol": lo.get("idol_card_id"), "produce": lo.get("produce_id"), "round": lo.get("round"),
         "stage": meta.get("stage"), "mechanic": meta.get("mechanic")}
    for x in meta.get("tags") or []:
        k, _, v = x.partition(":")
        if v and k != "name":
            t[k] = v
    return {k: v for k, v in t.items() if v}


def problem_of(set_name, doc: dict) -> dict:
    lo = save.expand_loadout(doc["loadout"])
    meta = doc.get("meta") or {}
    name = next((t[5:] for t in meta.get("tags") or [] if t.startswith("name:")), doc["id"])
    return {"id": doc["id"], "family": meta.get("family") or save.family_id(lo), "set": set_name, "name": name,
            "loadout": lo, "meta": meta, "tags": _tags(doc, lo), "archive": doc}


TEMPLATE_SEEDS_VERSION = "fixed32.v1"   # 和 server/tseeds.go 一致


def template_seeds_path(set_name):
    return DATA / "private" / "seeds" / f"{set_name}.template.json"


def template_seed_rows(set_name) -> dict:
    """题模板的固定保密种子（服务器 tseeds.go 生成，管理员从服务器拷来）→ {题模板编号: [种子行]}"""
    p = template_seeds_path(set_name)
    if not p.is_file():
        raise SystemExit(f"没有 {p}：题模板的固定种子由服务器生成，先从服务器拷过来（权限 600）")
    doc = json.loads(p.read_text())
    return {pid: [{"index": i, "seed": int(x), "split": "template", "label": "保密"} for i, x in enumerate(v["seeds"])]
            for pid, v in doc["problems"].items()}


def load_set(set_name, only=None, template=False):
    d = problems_dir(set_name)
    if not d.is_dir():
        raise SystemExit(f"没有题集 {set_name}（{d}）")
    if template:
        seeds = template_seed_rows(set_name)
    else:
        sp = seeds_path(set_name)
        seeds = json.loads(sp.read_text())["problems"] if sp.is_file() else {}
    out = []
    for f in sorted(d.glob("*.gksave.json")):
        p = problem_of(set_name, json.loads(f.read_text()))
        if only and not any(o in p["id"] or o in p["name"] for o in only):
            continue
        out.append((p, seeds.get(p["id"], [])))
    out.sort(key=lambda x: x[0]["name"])
    return out


def list_sets():
    root = DATA / "problems"
    return sorted(p.name for p in root.iterdir() if p.is_dir()) if root.is_dir() else []
