"""已知最好分：各处找到的路线按局（题 + 牌序）取最高的一条，由本机裁判照着重打一遍，生成一次上限运行。

排行的「相对上限」按局取所有上限运行里的最高分，所以这次运行放上服务器后分母只会升、不会降。

路线来源：
  --farm FILE…   多起点搜索的结果（jsonl，每行 {"id", "idx", "score", "route"}；.temp/oracle-farm 的 farm.py 产出）
  本机已有的上限运行（runs/ 下同一题集、privileged、保密牌序的运行），自动算进去

    python -m gkbench.bestknown --set hif-live --farm all.jsonl new5.jsonl [--only 子串,…] [--seeds 0,1] [--label best-known]

分数以本机裁判重打出来的为准；农场报的分只用来挑路线。跑完打印运行目录，照 README 把它放到服务器 runs/ 下。
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from . import save
from .algos.base import Algorithm, Decision
from .problems import DATA, load_set
from .runner import read_episodes, run

ABOUT = {
    "summary": "已知最好分：每一局取目前找到的最高分路线，由裁判照着重打。提前知道整局牌序，只作「相对上限」的分母，不参与排名。",
    "detail": [
        "路线来自多起点搜索：同一局从很多个不同的搜索起点各搜一次（GKMS 的 GNRPA，预算按搜索步数计），再和以前的上限运行比，取分数最高的一条。",
        "它不是证明过的最优解：起点越多还能更高，以后找到更好的路线就再更新，分母只升不降。",
    ],
    "sees": "seed",
    "links": [{"title": "本仓库实现 gkbench/bestknown.py", "url": "https://github.com/matto49/gakumas-bench/blob/develop/gkbench/bestknown.py"},
              {"title": "GNRPA 论文（Cazenave, 2024）", "url": "https://arxiv.org/abs/2401.10431"}],
}


KEEP = 8      # 每局留报分最高的几条路线，重打时取裁判算出来最高的那条


def collect(set_name, farm_files=(), run_dirs=None, keep=KEEP):
    """→ {(题模板编号, 牌序下标): [{"score", "route"（动作元组列表）, "src"}…]}，每局留报分最高的 keep 条（高的在前）。
    留几条是因为搜索时的引擎可能比裁判旧：报分最高的路线在裁判上未必还走得通（2026-11-11 规则 59 改了出牌时触发的体力判定）。"""
    best = {}

    def offer(key, score, route, src):
        if not route:
            return
        xs = best.setdefault(key, [])
        if any(x["route"] == route for x in xs):
            return
        xs.append({"score": int(score), "route": route, "src": src})
        xs.sort(key=lambda x: -x["score"])
        del xs[keep:]

    for f in farm_files:
        for line in open(f, encoding="utf-8"):
            if not line.strip():
                continue
            r = json.loads(line)
            if r.get("error") or not r.get("route"):
                continue
            route = [tuple(a) if a[0] != "select" else ("select", list(a[1])) for a in r["route"]]
            offer((r["id"], int(r["idx"])), r["score"], route, f"farm:{Path(f).name}#{r.get('start')}")
    if run_dirs is None:
        run_dirs = []
        for d in sorted((DATA / "runs").iterdir()):
            try:
                info = json.loads((d / "run.json").read_text())
            except Exception:
                continue
            if info.get("set") == set_name and info.get("privileged") and info.get("kind") == "template" \
                    and info.get("template_seeds") and info.get("finished"):
                run_dirs.append(d)
    for d in run_dirs:
        for e in read_episodes(d):
            if e.get("err") or not e.get("route"):
                continue
            offer((e["id"], int(e["seed_index"])), e["final"]["score"], save.parse_route(e["route"]), f"run:{Path(d).name}")
    return best


def replay_score(loadout, seed, route):
    """在裁判上照路线打（选择交给引擎，和 RouteAlgo 一样），走不通就停：返回 (分数, 是否走完)。用来在几条候选路线里挑。"""
    from . import engine
    s, _ = engine.build({k: v for k, v in loadout.items() if k != "seed"}, int(seed))
    for a in route:
        if a[0] == "select":
            continue
        if s.finished:
            break
        if tuple(a) not in [tuple(x) for x in s.legal_actions()]:
            return int(s.observe()["score"]), False
        s.step(tuple(a))
    return int(s.observe()["score"]), bool(s.finished)


def pick(loadout, seed, cands):
    """候选路线按裁判重打的分数挑最高的；报分最高那条在裁判上分数不变就直接用它（省时间）。"""
    first = cands[0]
    sc, done = replay_score(loadout, seed, first["route"])
    if done and sc == first["score"] or len(cands) == 1:
        return dict(first, score=sc)
    best = dict(first, score=sc)
    for c in cands[1:]:
        sc, done = replay_score(loadout, seed, c["route"])
        if sc > best["score"]:
            best = dict(c, score=sc)
    return best


class RouteAlgo(Algorithm):
    """照给定路线打（理论上限一类：要知道这一局是哪种牌序才知道用哪条路线）。路线走不通时在真局面上补搜。"""
    name = "best-known"
    privileged = True
    about = ABOUT

    def __init__(self, routes):
        # 来源统计不放参数里：参数相同的运行才合成排行的一行，每批来源数不同会拆成很多行
        super().__init__()
        self.routes = routes            # {(题模板编号, 种子): {"score", "route", "src"}}

    def begin(self, ctx):
        pid = save.archive_id({k: v for k, v in ctx.loadout.items() if k != "seed"})
        hit = self.routes.get((pid, int(ctx.seed)))
        if hit is None:
            raise RuntimeError(f"没有 {pid} 这一局的路线")
        self.route, self.claimed, self.src, self.k = list(hit["route"]), hit["score"], hit["src"], 0

    def decide(self, ctx):
        legal = [tuple(a) for a in ctx.obs["legal"]]
        meta = {"claimed": self.claimed, "source": self.src, "route_len": len(self.route)} if self.k == 0 else {}
        while self.k < len(self.route) and self.route[self.k][0] == "select":
            self.k += 1
        if self.k < len(self.route) and tuple(self.route[self.k]) in legal:
            a = tuple(self.route[self.k])
            self.k += 1
            return Decision(a, meta)
        from .algos.search import _first_action
        from .engine import native, prior
        _, ns = native()
        path, _st = ns.policy_search(ctx.true_session.clone(), deadline=10.0, seed=182, prior=prior())
        self.route, self.k = [tuple(a) for a in path or ()], 0
        a = _first_action(self.route)
        if a in legal:
            self.k = self.route.index(a) + 1
        else:
            a = legal[0]
        return Decision(a, dict(meta, resolved=True))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--set", required=True)
    ap.add_argument("--farm", nargs="*", default=[])
    ap.add_argument("--only", default=None)
    ap.add_argument("--seeds", default=None, help="只打这些牌序下标，逗号分隔（调试用）")
    ap.add_argument("--label", default="best-known")
    a = ap.parse_args(argv)
    farm = [str(Path(f).expanduser().resolve()) for f in a.farm]     # 引擎会切换当前目录，先转成绝对路径
    only = a.only.split(",") if a.only else None
    idx = [int(x) for x in a.seeds.split(",")] if a.seeds else None
    best = collect(a.set, farm)
    routes, missing, src = {}, [], {}
    for p, rows in load_set(a.set, only, template=True):
        for row in rows:
            if idx is not None and int(row["index"]) not in idx:
                continue
            cands = best.get((p["id"], int(row["index"])))
            if not cands:
                missing.append(f"{p['name']}#{row['index']}")
                continue
            hit = pick(p["loadout"], int(row["seed"]), cands)
            routes[(p["id"], int(row["seed"]))] = hit
            kind = hit["src"].split(":")[0]
            src[kind] = src.get(kind, 0) + 1
    if missing:
        raise SystemExit(f"{len(missing)} 局没有路线（先把它们搜出来）：{missing[:6]}…")
    print(f"{len(routes)} 局，路线来源：{src}", flush=True)
    t = time.time()
    out = run(a.set, RouteAlgo(routes), 5.0, idx, only, a.label, keep_obs=True, template=True)
    info = json.loads((out / "run.json").read_text())
    info.update(ABOUT)                                   # 算法说明写进运行表头，网页的运行页和排行会显示
    info["route_sources"] = src                          # 路线来源统计（农场 / 以前的上限运行各几局）
    low = []
    for e in read_episodes(out):
        m = (e["steps"][0].get("algo_meta") or {}) if e.get("steps") else {}
        if m.get("claimed") and e["final"]["score"] != m["claimed"]:
            low.append((e.get("name"), e.get("seed_index"), m["claimed"], e["final"]["score"]))
    info["claimed_mismatch"] = len(low)
    (out / "run.json").write_text(json.dumps(info, ensure_ascii=False, indent=1))
    print(f"完成 {info['episodes']} 局，平均 {info['mean_score']:,}，用时 {time.time() - t:.0f}s；"
          f"重打出来和报分不一样的 {len(low)} 局{'：' + str(low[:5]) if low else ''}")
    print(out)


if __name__ == "__main__":
    main()
