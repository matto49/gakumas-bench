"""把旧数据（gkbench.problem.v1 / seeds.v1 / run.v1 / episode.v1）转成按审查存档格式组织的 v2。

  python -m gkbench.migrate            # 处理 $GKBENCH_DATA
  python -m gkbench.migrate --dry-run  # 只报告

可以重复运行：已经是 v2 的部分跳过。改动之前把原文件复制到 $GKBENCH_DATA/backup-v1/。
"""
from __future__ import annotations

import argparse
import io
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path

import zstandard

from . import problems as P
from . import save

MODE = {"upload": "self", "hosted": "hosted", "random": "hosted", None: "self", "": "self"}


def _ts(iso):
    if not iso:
        return save.now_ts()
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).strftime("%Y%m%dT%H%M%SZ")
    except ValueError:
        return save.now_ts()


def _backup(root, path):
    dst = root / "backup-v1" / path.relative_to(root)
    if path.exists() and not dst.exists():
        dst.parent.mkdir(parents=True, exist_ok=True)
        (shutil.copytree if path.is_dir() else shutil.copy2)(path, dst)


def migrate_set(root, set_name, dry):
    """返回 {旧题号: (题模板编号, 种子行列表)}。"""
    sp = P.seeds_path(set_name)
    if not sp.is_file():
        return {}
    seeds_doc = json.loads(sp.read_text())
    old_files = sorted(P.problems_dir(set_name).glob("*.json"))
    old_files = [f for f in old_files if not f.name.endswith(".gksave.json")]
    mapping = {}
    if seeds_doc.get("schema") == P.SEEDS_SCHEMA:
        # 已迁移：从题模板的 name 标签恢复对照
        for p, rows in P.load_set(set_name):
            mapping[p["name"]] = (p["id"], rows)
        return mapping
    print(f"题集 {set_name}：{len(old_files)} 道题转成题模板", flush=True)
    if dry:
        return {}
    _backup(root, sp)
    _backup(root, P.problems_dir(set_name))
    old_seeds = seeds_doc["problems"]
    sp.unlink()                                       # add_problem 会写新的 seeds.v2
    for f in old_files:
        p = json.loads(f.read_text())
        tags = p.get("tags") or {}
        if tags.get("source") == "gkms-bench":
            key = "/".join(str(tags.get(k)) for k in ("mechanic", "idol", "deck", "stage"))
            source, extra = {"kind": "bench", "problem": key}, [f"deck:{tags['deck']}"] if tags.get("deck") else []
        else:
            source, extra = {"kind": "manual", "note": f"实机开局 {(p.get('source') or {}).get('file', p['id'])}"}, []
        rows = old_seeds.get(p["id"], [])
        tid = P.add_problem(set_name, p["loadout"], name=p["id"], source=source, tags=extra,
                            seeds=[(r["seed"], r.get("split", "dev"), r.get("label", "")) for r in rows])
        mapping[p["id"]] = (tid, json.loads(sp.read_text())["problems"][tid])
        f.unlink()
    return mapping


def _read(path):
    with open(path, "rb") as fh:
        r = zstandard.ZstdDecompressor().stream_reader(fh, read_across_frames=True)
        return [json.loads(l) for l in io.TextIOWrapper(r, encoding="utf-8") if l.strip()]


def _write(path, eps):
    with open(path, "wb") as fh:
        w = zstandard.ZstdCompressor(level=6).stream_writer(fh)
        tw = io.TextIOWrapper(w, encoding="utf-8")
        for e in eps:
            tw.write(json.dumps(e, ensure_ascii=False) + "\n")
        tw.close()


def run_v2(info):
    if info.get("schema") == "gkbench.run.v2":
        return info
    algo = info.get("algo") or {}
    name = algo.get("name") or info.get("label") or "unknown"
    params = {k: v for k, v in (algo.get("params") or {}).items() if v is not None}
    privileged = bool(algo.get("privileged"))
    mode = "internal" if privileged else MODE.get(info.get("mode"), "self")
    machine = info.get("machine")
    out = {"schema": "gkbench.run.v2", "run": info["run"], "label": info.get("label") or name, "set": info["set"],
           "kind": "template" if info.get("mode") == "random" else "fixed",
           "algo": name if name.startswith("external:") else f"external:{name}",
           "rules": int((info.get("engine") or {}).get("rules_version") or 0), "mode": mode,
           "privileged": privileged, "engine": info.get("engine")}
    if params:
        out["params"] = params
    if privileged and params.get("seconds"):
        out["seconds"] = params["seconds"]
    elif info.get("budget_s") is not None:
        out["step_seconds"] = info["budget_s"]
    if isinstance(machine, dict):
        out["machine"] = machine.get("host")
    elif machine:
        out["machine"] = machine
    if info.get("uploader"):
        out["by"] = info["uploader"]
    for k in ("started", "finished", "uploaded", "episodes", "mean_score", "verified", "eval", "seeds_per_problem",
              "seed_indices", "only"):
        if k in info:
            out[k] = info[k]
    return out


def episode_v2(e, mapping, info, template):
    if e.get("schema") == "gkbench.episode.v2":
        return e
    tid, rows = mapping[e["problem"]]
    row = next((r for r in rows if r["index"] == e["seed_index"]), None)
    steps = []
    for s in e.get("steps") or []:
        a = s["action"]
        steps.append({"i": s.get("i"), "turn": s.get("turn"), "token": save.token_of(a), "action": a,
                      "obs": s.get("obs"), "algo_meta": s.get("algo_meta"), "step_ms": s.get("think_ms", 0),
                      "cpu_ms": s.get("cpu_ms"), "worlds": s.get("worlds", 0), "over": bool(s.get("over_budget")),
                      "result": s.get("result"), "private": s.get("private"),
                      **({"client_ms": s["client_ms"]} if s.get("client_ms") is not None else {})})
    f = e.get("final") or {}
    fam = None
    return {"schema": "gkbench.episode.v2", "id": tid, "family": fam, "set": e.get("set"), "name": e["problem"],
            "tags": e.get("tags") or {}, "fixed_id": None if template else (row or {}).get("fixed_id"),
            "seed_index": e["seed_index"], "seed_label": e.get("seed_label"),
            "seed_split": "random" if template else e.get("seed_split"), "exam_sha": e.get("seed_sha"),
            "meta": e.get("meta"), "route": " ".join(s["token"] for s in steps), "steps": steps,
            "final": {"score": f.get("score"), "finished": f.get("finished"), "decisions": f.get("decisions"),
                      "turns": f.get("turns"), "begin_s": f.get("begin_s", 0.0), "secs": f.get("think_s"),
                      "wall_s": f.get("wall_s"), "over_steps": f.get("over_budget_steps", 0)},
            "err": e.get("error"), "at": _ts(info.get("finished") or info.get("uploaded") or info.get("started")),
            "run": e.get("run") or info["run"]}


def main(argv=None):
    ap = argparse.ArgumentParser(prog="gkbench.migrate")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    root = P.DATA
    print(f"数据目录 {root}", flush=True)
    maps = {s: migrate_set(root, s, a.dry_run) for s in P.list_sets()}
    families = {}
    for s in P.list_sets():
        for p, _ in P.load_set(s):
            families[p["id"]] = p["family"]
    # 私有评测文件：种子按题模板编号重排
    for f in sorted((root / "private" / "evals").glob("*.json")):
        ev = json.loads(f.read_text())
        m = maps.get(ev.get("set"), {})
        if any(k in m for k in ev.get("seeds", {})):
            print(f"评测 {f.stem}：题号改成题模板编号", flush=True)
            if not a.dry_run:
                _backup(root, f)
                ev["seeds"] = {m[k][0] if k in m else k: v for k, v in ev["seeds"].items()}
                f.write_text(json.dumps(ev, ensure_ascii=False, indent=1))
    # 运行
    for d in sorted((root / "runs").glob("*/run.json")):
        d = d.parent
        info = json.loads((d / "run.json").read_text())
        if info.get("schema") == "gkbench.run.v2":
            continue
        m = maps.get(info.get("set"), {})
        template = info.get("mode") == "random"
        eps_path = d / "episodes.jsonl.zst"
        eps = _read(eps_path) if eps_path.is_file() else []
        missing = {e["problem"] for e in eps if e.get("problem") not in m}
        if missing:
            print(f"跳过 {d.name}：题号对不上 {sorted(missing)[:3]}", flush=True)
            continue
        print(f"运行 {d.name}：{len(eps)} 局", flush=True)
        if a.dry_run:
            continue
        _backup(root, d)
        new_info = run_v2(info)
        new = []
        for e in eps:
            x = episode_v2(e, m, info, template)
            x["family"] = families.get(x["id"])
            new.append(x)
        _write(eps_path, new)
        (d / "run.json").write_text(json.dumps(new_info, ensure_ascii=False, indent=1))
        for idx in ("index.json", "index.jsonl"):
            (d / idx).unlink(missing_ok=True)                 # 服务器按 v2 重新生成摘要
    print("完成", flush=True)


if __name__ == "__main__":
    sys.exit(main())
