"""题库：题目（公开）和种子（私有）分开存。

  $GKBENCH_DATA/problems/<题集>/<题目>.json     gkbench.problem.v1：开局配置（不含种子）+ 标签 + 来源
  $GKBENCH_DATA/private/seeds/<题集>.json       gkbench.seeds.v1：每道题的种子列表（下标、种子、分组 dev/test、说明）

$GKBENCH_DATA 默认 ~/github/gakumas-bench-data，不在代码仓库里。种子只有裁判读，记录里只写下标和哈希。
"""
from __future__ import annotations

import hashlib
import json
import os
import random
import re
from pathlib import Path

DATA = Path(os.environ.get("GKBENCH_DATA", Path.home() / "github/gakumas-bench-data")).expanduser().resolve()
PROBLEM_SCHEMA = "gkbench.problem.v1"
SEEDS_SCHEMA = "gkbench.seeds.v1"


def problems_dir(set_name):
    return DATA / "problems" / set_name


def seeds_path(set_name):
    return DATA / "private" / "seeds" / f"{set_name}.json"


def seed_sha(seed) -> str:
    return hashlib.sha256(str(int(seed)).encode()).hexdigest()[:12]


def _slug(s):
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", s).strip("-")


def _public_loadout(lo):
    return {k: v for k, v in lo.items() if k not in ("seed", "source") and not k.startswith("_")}


def _random_seeds(pid, n):
    rng = random.Random(int(hashlib.sha256(pid.encode()).hexdigest()[:12], 16))
    return [rng.randrange(1, 2 ** 31 - 1) for _ in range(n)]


def save_set(set_name, problems, seeds):
    d = problems_dir(set_name)
    d.mkdir(parents=True, exist_ok=True)
    for p in problems:
        (d / f"{p['id']}.json").write_text(json.dumps(p, ensure_ascii=False, indent=1))
    sp = seeds_path(set_name)
    sp.parent.mkdir(parents=True, exist_ok=True)
    old = json.loads(sp.read_text())["problems"] if sp.is_file() else {}
    old.update(seeds)
    sp.write_text(json.dumps({"schema": SEEDS_SCHEMA, "set": set_name, "problems": old}, ensure_ascii=False, indent=1))
    os.chmod(sp, 0o600)
    return d


def import_loadouts(src_dir, set_name, random_seeds=4):
    """一批 gkms.hif_loadout.v1（例如从实机存档转出来的开局）。带 seed 的，下标 0 记为「实机」种子。"""
    problems, seeds = [], {}
    for f in sorted(Path(src_dir).expanduser().glob("*.json")):
        lo = json.loads(f.read_text())
        if lo.get("schema") != "gkms.hif_loadout.v1":
            continue
        pid = _slug(f.stem.replace("-opening-decoded", "").replace("__", "-"))
        rows = []
        if lo.get("seed") is not None:
            rows.append({"index": 0, "seed": int(lo["seed"]), "split": "dev", "label": "实机"})
        for s in _random_seeds(pid, random_seeds):
            rows.append({"index": len(rows), "seed": s, "split": "dev", "label": "随机"})
        problems.append({"schema": PROBLEM_SCHEMA, "id": pid, "set": set_name, "loadout": _public_loadout(lo),
                         "tags": {"idol": lo.get("idol_card_id"), "produce": lo.get("produce_id"),
                                  "round": lo.get("round"), "source": "loadout"},
                         "source": {"file": f.name}})
        seeds[pid] = rows
    return save_set(set_name, problems, seeds), len(problems)


def import_gkms_bench(problems_jsonl, set_name):
    """GKMS 自带的审查 benchmark（GakumasCLI/bench/problems.py build 的输出，每行一题一种子）。"""
    problems, seeds = {}, {}
    for line in Path(problems_jsonl).expanduser().read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        rid = str(row["id"])
        head, _, tail = rid.rpartition("/")
        pid = _slug(head if tail.isdigit() else rid)     # 题号末尾的 /0 /1 是种子下标，同一配置合成一题
        lo = row["loadout"]
        if pid not in problems:
            problems[pid] = {"schema": PROBLEM_SCHEMA, "id": pid, "set": set_name, "loadout": _public_loadout(lo),
                             "tags": {"idol": row.get("idol") or lo.get("idol_card_id"), "mechanic": row.get("mechanic"),
                                      "deck": row.get("deck"), "stage": row.get("stage"),
                                      "produce": lo.get("produce_id"), "round": lo.get("round"), "source": "gkms-bench"},
                             "source": {"file": Path(problems_jsonl).name}}
            seeds[pid] = []
        seed = row.get("seed", lo.get("seed"))
        if seed is not None and all(r["seed"] != int(seed) for r in seeds[pid]):
            seeds[pid].append({"index": len(seeds[pid]), "seed": int(seed), "split": "dev", "label": "gkms"})
    return save_set(set_name, list(problems.values()), seeds), len(problems)


def load_set(set_name, only=None):
    d = problems_dir(set_name)
    if not d.is_dir():
        raise SystemExit(f"没有题集 {set_name}（{d}）")
    seeds = json.loads(seeds_path(set_name).read_text())["problems"]
    out = []
    for f in sorted(d.glob("*.json")):
        p = json.loads(f.read_text())
        if only and not any(o in p["id"] for o in only):
            continue
        out.append((p, seeds.get(p["id"], [])))
    return out


def list_sets():
    root = DATA / "problems"
    return sorted(p.name for p in root.iterdir() if p.is_dir()) if root.is_dir() else []
