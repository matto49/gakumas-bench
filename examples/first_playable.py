"""最小的自定义算法示例：能打牌就打手里第一张能打的，否则结束回合。不需要 GKMS。

托管评测（种子留在服务器，只交动作）：
    python -m gkbench eval --set hif-live --algo examples/first_playable.py:FirstPlayable --seeds 4

ctx.obs 是公开观测（UIObs v1，字段见 docs/format.md「公开观测」），ctx.obs["legal"] 是合法动作列表，
返回的动作必须是其中之一：["play", 手牌下标] / ["drink", 饮料下标] / ["end"] / 选牌时的 ["select", …]。
"""
from gkbench.algos.base import Algorithm, Decision


class FirstPlayable(Algorithm):
    name = "first-playable"
    about = {"summary": "能打就打第一张能打的牌，不喝饮料；示例算法", "sees": "screen"}

    def decide(self, ctx):
        legal = [tuple(a) for a in ctx.obs["legal"]]
        plays = [a for a in legal if a[0] == "play"]
        if plays:
            return Decision(plays[0], {"why": "第一张能打的牌"})
        if ("end",) in legal:
            return Decision(("end",), {"why": "没牌可打"})
        return Decision(legal[0], {"why": "其他决策取第一个"})
