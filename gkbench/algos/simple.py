"""下限算法：随机、贪心。"""
from __future__ import annotations

from .base import Algorithm, Decision


class RandomAlgo(Algorithm):
    """在合法动作里均匀随机选。"""
    name = "random"

    def decide(self, ctx):
        legal = [tuple(a) for a in ctx.obs["legal"]]
        return Decision(ctx.rng.choice(legal))


class GreedyAlgo(Algorithm):
    """GKMS 的贪心：出眼前估计加分最多、付得起的牌，没有就结束回合；不喝饮料。
    它只读当前局面，不看山札顺序，所以在随机世界上算，结果和真局面一样。"""
    name = "greedy"

    def decide(self, ctx):
        from GakumasCLI.scenario.exam_session import greedy_policy
        legal = [tuple(a) for a in ctx.obs["legal"]]
        world = ctx.worlds(1)[0]
        choice = greedy_policy(world, list(world.deck.hand))
        action = ("end",) if choice is None else ("play", int(choice))
        if action not in legal:
            action = ("end",) if ("end",) in legal else legal[0]
        return Decision(action)
