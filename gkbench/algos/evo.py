"""不看牌序的三种算法（第三批）：进化调参的一步评估策略、开环蒙特卡洛搜索、按阶段换算法。

evo         一步评估：每个能做的动作先在一份局面拷贝上走一步，看数值变了多少（分数、元気、好印象、やる気、集中、
            全力値、体力、还能出几张、手牌数），按一张权重表打分，选分最高的；都不如「结束回合」就结束。
            权重随剩余回合线性变化（w = a + b × 剩余回合比例），共 22 个数，由进化算法（CEM）自动调：
            拿很多局的平均 log 分数当适应度（tools/evo_train.py，结果存 evo_theta.json）。
            它只读公开局面（数值、手牌、饮料），在一个隐藏信息重抽的世界上算。
olmc        开环蒙特卡洛搜索：对「动作序列」建树（动作按卡的身份记，不按手牌位置），每次模拟换一个重抽的世界走同一条
            序列，树外用 evo 策略打到底，回传终局分。同一条序列在很多种牌序下取平均，所以不会假设自己知道以后抽什么。
            预算按模拟次数（iters）给，不看钟。
hybrid      分段：剩余回合多时用 early 算法，剩余回合 ≤ switch 时换 late 算法（写法 hybrid:early=uinet,late=olmc,switch=3）。
"""
from __future__ import annotations

import json
import math
import random
from pathlib import Path

from .base import Algorithm, Decision

FEATS = ("score", "block", "review", "aggressive", "lesson_buff", "full_power_point", "stamina", "playable", "hand", "drink")
N = len(FEATS)
THETA_FILE = Path(__file__).with_name("evo_theta.json")
# 没调过时的起点：分数最要紧，状态类数值前期值钱、最后一回合不值钱
THETA0 = ([1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, -0.1] +          # a：最后一回合的权重
          [0.0, 0.3, 0.6, 0.6, 0.6, 0.3, 0.3, 0.3, 0.2, -0.3] +          # b：乘剩余回合比例
          [0.0, 0.0])                                                    # 结束回合的分：e0 + e1 × 比例


def load_theta(path=None):
    p = Path(path) if path else THETA_FILE
    if p.is_file():
        return list(json.loads(p.read_text())["theta"])
    return list(THETA0)


def _nums(s):
    st = s.state
    return (int(st.score), int(st.block), int(st.review), int(st.aggressive), int(st.lesson_buff),
            int(st.full_power_point), int(st.stamina), int(st.playable), len(s.deck.hand))


def _frac(s, limit):
    """这回合之后还剩几回合，占总回合的比例（最后一回合是 0）"""
    left = limit + int(getattr(s.state, "extra_turns", 0) or 0) - int(s.turn)
    return max(0.0, left / max(1, limit))


def _delta(b, a, turn_changed, max_stamina, is_drink):
    f = [math.copysign(math.log1p(abs(a[0] - b[0])), a[0] - b[0]) / 10.0,
         (a[1] - b[1]) / 10.0, (a[2] - b[2]) / 10.0, (a[3] - b[3]) / 10.0, (a[4] - b[4]) / 10.0, (a[5] - b[5]) / 10.0,
         (a[6] - b[6]) / max(1, max_stamina),
         0.0 if turn_changed else float(a[7] - b[7] + (0 if is_drink else 1)),
         0.0 if turn_changed else float(a[8] - b[8] + (0 if is_drink else 1)),
         1.0 if is_drink else 0.0]
    return f


class EvoPolicy:
    """session → 动作。只读公开的数值和手牌；一步模拟在传入的 session 拷贝上做。"""

    def __init__(self, theta=None, limit=None):
        self.theta = list(theta) if theta is not None else load_theta()
        self.limit = limit

    def scores(self, s, legal=None):
        legal = [tuple(a) for a in (legal if legal is not None else s.legal_actions())]
        if self.limit is None:
            self.limit = int(s.observe()["limit_turn"])
        th, fr = self.theta, _frac(s, self.limit)
        w = [th[k] + th[N + k] * fr for k in range(N)]
        end_v = th[2 * N] + th[2 * N + 1] * fr
        b, turn, ms = _nums(s), s.turn, int(s.state.max_stamina)
        base_end = None
        out = {}
        for a in legal:
            if a[0] == "end":
                out[a] = end_v
                continue
            c = s.clone()
            try:
                c.step(a if a[0] != "select" else ("select", list(a[1])), observe=False)
            except Exception:
                out[a] = -1e9
                continue
            changed = c.finished or c.turn != turn
            f = _delta(b, _nums(c), changed, ms, a[0] == "drink")
            v = sum(w[k] * f[k] for k in range(N))
            if changed and not c.finished:          # 这张牌顺带结束了回合：扣掉「直接结束回合」也会有的那部分变化
                if base_end is None:
                    e = s.clone()
                    e.step(("end",), observe=False)
                    base_end = _delta(b, _nums(e), True, ms, False)
                v -= sum(w[k] * base_end[k] for k in range(N)) - end_v
            out[a] = v
        return out

    def act(self, s, legal=None, rng=None, eps=0.0):
        sc = self.scores(s, legal)
        if rng is not None and eps > 0 and rng.random() < eps:
            return rng.choice(list(sc))
        return max(sc, key=sc.get)


def play_out(s, policy, rng=None, eps=0.0, cap=400):
    n = 0
    while not s.finished and n < cap:
        a = policy.act(s, rng=rng, eps=eps)
        s.step(a if a[0] != "select" else ("select", list(a[1])), observe=False)
        n += 1
    return int(s.state.score)


class EvoAlgo(Algorithm):
    name = "evo"
    needs_gkms = True
    about = {"summary": "一步评估 + 进化调参：每个动作先试走一步，看分数和各项状态变了多少，按一张进化算法调出来的权重表打分，选最高的。",
             "detail": ["权重随剩余回合变化：越到后面越看重眼前的分数。22 个权重由进化算法（CEM）拿平均 log 分数当目标调出来。",
                        "只读公开局面，不往后推演，每步不到 1 毫秒。"],
             "sees": "screen"}

    def __init__(self, theta=None, **kw):
        super().__init__(theta=theta, **kw)
        self.theta = load_theta(theta)

    def begin(self, ctx):
        self.policy = EvoPolicy(self.theta, int(ctx.meta["limit_turn"]))

    def decide(self, ctx):
        legal = [tuple(a) for a in ctx.obs["legal"]]
        if len(legal) == 1:
            return Decision(legal[0], {"forced": True})
        w = ctx.worlds(1)[0]
        sc = self.policy.scores(w, legal)
        best = max(sc, key=sc.get)
        return Decision(best, {"values": {str(list(a)): round(v, 3) for a, v in sorted(sc.items(), key=lambda x: -x[1])[:4]}})


def _key(s, a):
    """动作的身份：出牌按「哪张卡、第几档」，喝饮料按饮料编号。换一个世界手牌位置会变，身份不变。"""
    if a[0] == "play":
        c = s.deck.hand[a[1]]
        return ("play", c["produce_card_id"], int(c.get("current_upgrade_count") or 0))
    if a[0] == "drink":
        return ("drink", s.drinks[a[1]])
    return (a[0],) if a[0] != "select" else ("select", tuple(a[1]))


def best_line(s, cap=30000):
    """最后一回合没有看不见的东西：把这一回合所有打法走一遍，返回（终局分最高的第一步, 分数, 看了多少个局面）。
    局面数超过 cap 就停，返回当时最好的。"""
    turn = int(s.turn)
    seen = [0]

    def go(x):
        seen[0] += 1
        if x.finished or int(x.turn) != turn or seen[0] > cap:
            return int(x.state.score)
        best = -1
        for a in x.legal_actions():
            a = tuple(a)
            c = x.clone()
            try:
                c.step(a if a[0] != "select" else ("select", list(a[1])), observe=False)
            except Exception:
                continue
            best = max(best, go(c))
        return best if best >= 0 else int(x.state.score)

    out = (None, -1)
    for a in s.legal_actions():
        a = tuple(a)
        c = s.clone()
        try:
            c.step(a if a[0] != "select" else ("select", list(a[1])), observe=False)
        except Exception:
            continue
        v = go(c)
        if v > out[1]:
            out = (a, v)
    return out[0], out[1], seen[0]


class OlmcAlgo(Algorithm):
    name = "olmc"
    needs_gkms = True
    about = {"summary": "开环蒙特卡洛搜索：对动作序列建树，每次模拟换一种重抽的牌序走同一条序列，树外用一步评估策略打到底，取平均终局分最高的第一步。",
             "detail": ["动作按卡的身份记（哪张卡、第几档），所以同一条序列在不同牌序下含义相同；某个世界里走不了的分支在那次模拟里跳过。",
                        "同一条序列的价值是很多种牌序下的平均，不会像 PIMC 那样假设自己知道以后抽什么。",
                        "预算按模拟次数给（iters），不看钟；树外的策略见 evo。",
                        "最后一回合没有看不见的东西，直接把这一回合所有打法算一遍取最高分。"],
             "sees": "screen"}

    def __init__(self, iters=200, worlds=24, depth=8, c=0.6, eps=0.05, theta=None, exact=1, **kw):
        super().__init__(iters=iters, worlds=worlds, depth=depth, c=c, eps=eps, theta=theta, exact=exact, **kw)
        self.iters, self.worlds_n, self.depth, self.c, self.eps = int(iters), int(worlds), int(depth), float(c), float(eps)
        self.exact = bool(int(exact))
        self.theta = load_theta(theta)

    def begin(self, ctx):
        self.policy = EvoPolicy(self.theta, int(ctx.meta["limit_turn"]))

    def decide(self, ctx):
        legal = [tuple(a) for a in ctx.obs["legal"]]
        if len(legal) == 1:
            return Decision(legal[0], {"forced": True})
        ex = ctx.obs["exam"]
        if self.exact and int(ex["turn"]) >= int(ex["limit"]):        # 最后一回合：直接把所有打法算一遍
            a, v, n = best_line(ctx.worlds(1)[0])
            if a in legal:
                return Decision(a, {"exact": True, "final": v, "states": n})
        worlds = ctx.worlds(self.worlds_n)
        rng = ctx.rng
        root = {}                                   # 节点：{动作身份: [次数, 分数和, 子节点]}
        base = max(1.0, float(worlds[0].state.score))
        lo, hi = float("inf"), float("-inf")
        for it in range(self.iters):
            w = worlds[it % len(worlds)].clone()
            node, path = root, []
            for _d in range(self.depth):
                if w.finished:
                    break
                acts = {}
                for a in w.legal_actions():
                    a = tuple(a)
                    acts.setdefault(_key(w, a), a)
                fresh = [k for k in acts if k not in node]
                if fresh:
                    if len(fresh) > 1:              # 没试过的先按一步评估的分排，优先试看起来好的
                        sc = self.policy.scores(w, [acts[k] for k in fresh])
                        k = max(fresh, key=lambda x: sc[acts[x]])
                    else:
                        k = fresh[0]
                    node[k] = [0, 0.0, {}]
                else:
                    tot = sum(node[k][0] for k in acts)
                    span = max(1e-9, hi - lo)
                    k = max(acts, key=lambda x: (node[x][1] / node[x][0] - lo) / span
                            + self.c * math.sqrt(math.log(tot + 1) / node[x][0]))
                a = acts[k]
                w.step(a if a[0] != "select" else ("select", list(a[1])), observe=False)
                path.append(node[k])
                node = node[k][2]
                if len(path) > 0 and path[-1][0] == 0:
                    break                           # 新节点：到这里就交给树外策略
            v = math.log(max(1.0, play_out(w, self.policy, rng, self.eps)) / base + 1.0)
            lo, hi = min(lo, v), max(hi, v)
            for nd in path:
                nd[0] += 1
                nd[1] += v
        first = {}
        w0 = worlds[0]
        for a in legal:
            first.setdefault(_key(w0, a), a)
        seen = {k: root[k] for k in first if k in root and root[k][0] > 0}
        if not seen:
            return Decision(legal[0], {"fallback": True})
        best = max(seen, key=lambda k: (seen[k][0], seen[k][1] / seen[k][0]))
        return Decision(first[best], {"iters": self.iters, "visits": {str(list(first[k])): [seen[k][0], round(seen[k][1] / seen[k][0], 4)]
                                                                 for k in sorted(seen, key=lambda k: -seen[k][0])[:5]}})


class HybridAlgo(Algorithm):
    name = "hybrid"
    needs_gkms = True

    def __init__(self, early="uinet", late="olmc", switch=3, **kw):
        super().__init__(early=early, late=late, switch=switch, **kw)
        from . import make
        # 参数里的冒号、逗号会和命令行写法冲突：子算法的参数用「/」分隔，例如 late=olmc/iters=400
        self.early, self.late, self.switch = make(str(early).replace("/", ":", 1).replace("/", ",")), \
            make(str(late).replace("/", ":", 1).replace("/", ",")), int(switch)
        self.about = {"summary": f"分段：剩余回合多于 {self.switch} 时用 {early}，之后换成 {late}。", "sees": "screen"}

    def begin(self, ctx):
        self.early.begin(ctx)
        self.late.begin(ctx)

    def decide(self, ctx):
        ex = ctx.obs["exam"]
        left = int(ex["limit"]) - int(ex["turn"]) + 1          # 含本回合还剩几回合
        algo = self.late if left <= self.switch else self.early
        d = algo.decide(ctx)
        d.meta = dict(d.meta or {}, by=algo.name)
        return d
