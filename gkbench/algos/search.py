"""基于 GKMS 原生搜索（GNRPA）的算法：PIMC（不看种子）和理论上限（看种子）。"""
from __future__ import annotations

import os
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

from .base import Algorithm, Decision


def _first_action(path):
    for a in path or ():
        if a and a[0] != "select":
            return tuple(a)
    return None


def _score(session):
    return int(session.observe()["score"])


class PimcAlgo(Algorithm):
    needs_gkms = True
    """确定化（PIMC）：把看不见的部分随机补全成 worlds 个世界，每个世界用 GNRPA 搜 seconds 秒。

    mode = "vote"：每个世界搜整条路线，按第一步投票（平票比平均预期分）。
    mode = "eval"：每个合法动作 × 每个世界（各动作共用同一组世界）先走这一步再搜，取平均分最高的动作。
    seconds 不给时按预算算：(预算 − 已经花掉的时间 − 0.15 秒余量) ÷ 搜索轮数 × 0.85。
    「已经花掉的」主要是取世界：本地采样很快，托管时要等服务器生成、走网络、再导入，约 1 秒。
    """
    name = "pimc"

    def __init__(self, worlds=16, seconds=None, mode="vote", threads=None, **kw):
        super().__init__(worlds=worlds, seconds=seconds, mode=mode, threads=threads, **kw)
        self.worlds_n, self.seconds, self.mode = int(worlds), seconds, mode
        self.threads = int(threads or os.cpu_count() or 8)
        self.pool = ThreadPoolExecutor(self.threads)

    def describe(self):
        d = super().describe()
        d["name"] = f"pimc-{self.mode}"
        return d

    def _deadline(self, ctx, searches, spent=0.0):
        if self.seconds:
            return float(self.seconds)
        waves = max(1, -(-searches // self.threads))
        return max(0.05, (ctx.budget - spent - 0.15) / waves * 0.85)

    def decide(self, ctx):
        from ..engine import native, prior
        _, ns = native()
        pr = prior()
        t0 = time.monotonic()
        legal = [tuple(a) for a in ctx.obs["legal"]]
        if len(legal) == 1:
            return Decision(legal[0], {"forced": True})
        worlds = ctx.worlds(self.worlds_n)
        spent = time.monotonic() - t0
        seeds = [ctx.rng.getrandbits(31) for _ in range(len(worlds) * (len(legal) if self.mode == "eval" else 1))]
        if self.mode == "eval":
            sec = self._deadline(ctx, len(legal) * len(worlds), spent)
            jobs = [(a, w, seeds[i * len(worlds) + k]) for i, a in enumerate(legal) for k, w in enumerate(worlds)]

            def run(job):
                a, w, sd = job
                w = w.clone()
                w.step(a)
                if w.finished:
                    return a, _score(w)
                _path, st = ns.policy_search(w, deadline=sec, seed=sd, prior=pr)
                return a, max(int(st.get("best_score", 0)), _score(w))

            tot = defaultdict(list)
            for a, v in self.pool.map(run, jobs):
                tot[a].append(v)
            means = {a: sum(v) / len(v) for a, v in tot.items()}
            best = max(means, key=means.get)
            return Decision(best, {"seconds_per_search": round(sec, 3), "worlds": len(worlds),
                                   "expected": {str(list(a)): int(v) for a, v in means.items()}})
        sec = self._deadline(ctx, len(worlds), spent)

        def run(job):
            w, sd = job
            path, st = ns.policy_search(w, deadline=sec, seed=sd, prior=pr)
            return _first_action(path), int(st.get("best_score", 0))

        votes, scores = defaultdict(int), defaultdict(list)
        for a, sc in self.pool.map(run, list(zip(worlds, seeds))):
            if a is None or a not in legal:
                continue
            votes[a] += 1
            scores[a].append(sc)
        if not votes:
            return Decision(legal[0], {"fallback": "no vote"})
        best = max(votes, key=lambda a: (votes[a], sum(scores[a]) / len(scores[a])))
        return Decision(best, {"seconds_per_search": round(sec, 3), "worlds": len(worlds), "worlds_s": round(spent, 3),
                               "votes": {str(list(a)): [votes[a], int(sum(scores[a]) / len(scores[a]))] for a in votes}})


class OracleAlgo(Algorithm):
    needs_gkms = True
    """理论上限：知道种子，用 GKMS 的正式求解（多次重启 + 末段精确求解）开局算一条整场路线，照着打。
    路线走不通时（理论上不会）在真局面上补搜。只作分母，不参与排名。"""
    name = "oracle"
    privileged = True

    def __init__(self, seconds=60, **kw):
        super().__init__(seconds=seconds, **kw)
        self.seconds = float(seconds)

    def begin(self, ctx):
        from GakumasCLI.advice import solve_loadout
        doc = dict(ctx.loadout, seed=int(ctx.seed))
        t = time.time()
        res = solve_loadout.run({"loadout": doc, "seconds": self.seconds})
        self.route = [tuple(a) for a in (res.get("route") or [])]
        self.predicted = res.get("score") or res.get("best_score")
        self.solve_s = time.time() - t
        self.k = 0

    def decide(self, ctx):
        legal = [tuple(a) for a in ctx.obs["legal"]]
        meta = {}
        if self.k == 0:
            meta = {"solve_seconds": round(self.solve_s, 2), "predicted": self.predicted, "route_len": len(self.route)}
        while self.k < len(self.route) and self.route[self.k][0] == "select":
            self.k += 1
        if self.k < len(self.route) and self.route[self.k] in legal:
            a = self.route[self.k]
            self.k += 1
            return Decision(a, meta)
        from ..engine import native, prior
        _, ns = native()
        path, st = ns.policy_search(ctx.true_session.clone(), deadline=min(10.0, self.seconds), seed=182, prior=prior())
        self.route, self.k = [tuple(a) for a in path or ()], 0
        a = _first_action(self.route)
        if a in legal:
            self.k = self.route.index(a) + 1
        else:
            a = legal[0]
        return Decision(a, dict(meta, resolved=True))
