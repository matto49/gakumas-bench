"""给一个集合挑核心题单（评测和排行缺省只看这些题、每题前几个牌序，见 server/collections.go SetConfig.Core）。

为什么要核心题单：同一道题换牌序的分差（对数 σ≈0.4）远大于相近算法在不同题上的差别（σ≈0.1～0.2），
所以同样的局数，多放题、每题少几个牌序更准；全量 hif 505 题 × 32 = 16160 局，慢算法跑不完。

挑法（分层，不随机抽）：
  1. 来源是实战（live）的题全留：它们是最早的一批，托管成绩和上限都在这些题上；
  2. 每张偶像卡至少一道；
  3. 每个「机制 × 关卡」组合至少两道（不够两道就全留）；
  4. 剩下的名额按「偶像 × 关卡」各组题量成比例分；
  5. 上面每一步组内都是随机挑。换不同的随机数各挑一遍（--tries 次），取子集和全量最接近的那份：
     用已有的全量运行（如 uinet / greedy / random，每题 32 个牌序），比较「子集每题前 k 个牌序」和「全量全部牌序」
     的按题平均分，以及两两算法的几何平均比，取最大偏差最小的一份。

    python -m gkbench.pick_core --set hif --n 120 --seeds 8 --algos uinet,greedy,random [--apply]

--apply 用管理员令牌把题单写到服务器（PATCH /api/sets/{set}）。中间数据缓存在 .temp/pick_core/。
"""
from __future__ import annotations

import argparse
import collections
import json
import math
import random
from pathlib import Path

import httpx

from .client import SERVER, _client

CACHE = Path(".temp/pick_core")


def fetch(set_name, algos, server):
    CACHE.mkdir(parents=True, exist_ok=True)
    probs = httpx.get(f"{server}/api/sets/{set_name}/problems", timeout=120).raise_for_status().json()
    runs = httpx.get(f"{server}/api/runs", timeout=120).raise_for_status().json()
    scores = collections.defaultdict(dict)        # 算法 → {(题, 牌序): 分}，同一格取最新
    stamp = {}
    for r in runs:
        if r.get("set") != set_name or r.get("kind") != "template" or r.get("label") not in algos or r.get("mode") == "hosted":
            continue
        f = CACHE / f"{r['run']}.json"
        if not f.is_file():
            f.write_text(json.dumps(httpx.get(f"{server}/api/runs/{r['run']}", timeout=120).raise_for_status().json()["episodes"]))
        for e in json.loads(f.read_text()):
            if not e.get("finished") or e.get("score") is None:
                continue
            k = (r["label"], e["id"], e["seed_index"])
            if k not in stamp or (r.get("finished") or "") > stamp[k]:
                stamp[k] = r.get("finished") or ""
                scores[r["label"]][(e["id"], e["seed_index"])] = e["score"]
    return probs, scores


def strata(probs):
    def tag(p, k):
        return (p.get("tags") or {}).get(k) or (p.get("scene") or {}).get(k)
    return {p["id"]: {"idol": tag(p, "idol"), "mechanic": tag(p, "mechanic"), "stage": tag(p, "stage"),
                      "source": (p.get("scene") or {}).get("source")} for p in probs}


def pick(info, n, rng):
    ids = sorted(info)
    chosen = {i for i in ids if info[i]["source"] == "live"}

    def add_from(pool):
        pool = [i for i in pool if i not in chosen]
        if pool:
            chosen.add(rng.choice(pool))

    groups = collections.defaultdict(list)
    for i in ids:
        groups[("idol", info[i]["idol"])].append(i)
        groups[("ms", info[i]["mechanic"], info[i]["stage"])].append(i)
        groups[("is", info[i]["idol"], info[i]["stage"])].append(i)
    for g, pool in sorted(groups.items(), key=str):          # 每张偶像卡至少一道
        if g[0] == "idol" and not chosen & set(pool):
            add_from(pool)
    for g, pool in sorted(groups.items(), key=str):          # 每个机制 × 关卡至少两道
        if g[0] == "ms":
            while len(chosen & set(pool)) < min(2, len(pool)):
                add_from(pool)
    cells = {g: pool for g, pool in groups.items() if g[0] == "is"}
    total = len(ids)
    while len(chosen) < n:                                    # 其余按偶像 × 关卡题量成比例
        def deficit(g):
            return n * len(cells[g]) / total - len(chosen & set(cells[g]))
        open_cells = [g for g in cells if set(cells[g]) - chosen]
        if not open_cells:
            break
        g = max(open_cells, key=lambda g: (deficit(g), rng.random()))
        add_from(cells[g])
    return sorted(chosen)


def per_problem_mean(sc, problems, k):
    by = collections.defaultdict(list)
    for (pid, s), v in sc.items():
        if pid in problems and s < k:
            by[pid].append(v)
    return sum(sum(v) / len(v) for v in by.values()) / max(1, len(by)), by


def deviation(scores, chosen, k):
    """子集（每题前 k 个牌序）对全量（全部牌序）的最大相对偏差：各算法按题平均分、两两几何平均比"""
    allp = {pid for sc in scores.values() for pid, _ in sc}
    out = {}
    for a, sc in scores.items():
        full, _ = per_problem_mean(sc, allp, 99)
        sub, _ = per_problem_mean(sc, set(chosen), k)
        out[f"{a} 平均分"] = sub / full - 1
    names = sorted(scores)
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            def geo(problems, kk):
                xs = [math.log(scores[a][c] + 1) - math.log(scores[b][c] + 1)
                      for c in scores[a] if c in scores[b] and c[0] in problems and c[1] < kk]
                return math.exp(sum(xs) / len(xs)) if xs else float("nan")
            out[f"{a}/{b} 几何比"] = geo(set(chosen), k) / geo(allp, 99) - 1
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", required=True)
    ap.add_argument("--n", type=int, default=120)
    ap.add_argument("--seeds", type=int, default=8)
    ap.add_argument("--algos", default="uinet,greedy,random")
    ap.add_argument("--tries", type=int, default=300)
    ap.add_argument("--seed", type=int, default=20261112)
    ap.add_argument("--server", default=SERVER)
    ap.add_argument("--apply", action="store_true", help="写到服务器（要管理员令牌）")
    a = ap.parse_args()
    probs, scores = fetch(a.set, set(a.algos.split(",")), a.server)
    info = strata(probs)
    rng = random.Random(a.seed)
    best = None
    for _ in range(a.tries):
        ch = pick(info, a.n, random.Random(rng.random()))
        dev = deviation(scores, ch, a.seeds)
        worst = max(abs(v) for v in dev.values())
        if best is None or worst < best[0]:
            best = (worst, ch, dev)
    worst, chosen, dev = best
    cnt = lambda k: collections.Counter(info[i][k] for i in chosen)  # noqa: E731
    print(f"{a.set}：{len(info)} 题里挑 {len(chosen)} 题 × {a.seeds} 牌序（{len(chosen) * a.seeds} 局）；{a.tries} 次里最大偏差 {worst:.2%}")
    for k, v in dev.items():
        print(f"  {k}: {v:+.2%}")
    print("  偶像卡", len(cnt("idol")), "/", len({x['idol'] for x in info.values()}), " 关卡", dict(cnt("stage")))
    print("  机制", dict(cnt("mechanic")), " 来源", dict(cnt("source")))
    CACHE.mkdir(parents=True, exist_ok=True)
    out = CACHE / f"{a.set}-core.json"
    out.write_text(json.dumps({"set": a.set, "core": chosen, "core_seeds": a.seeds, "deviation": dev}, ensure_ascii=False, indent=1))
    print("题单写到", out)
    if a.apply:
        with _client(a.server) as c:
            r = c.patch(f"/api/sets/{a.set}", json={"core": chosen, "core_seeds": a.seeds})
            print("写到服务器：", r.status_code, r.text[:200])


if __name__ == "__main__":
    main()
