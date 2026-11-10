"""算法接口。

每个决策点，跑分器调用 ``decide(ctx)``，算法返回 ``Decision``。ctx 里只有公开信息：
  ctx.obs          UIObs v1 公开观测（含 legal 合法动作）
  ctx.budget       这一步的时间预算（秒）
  ctx.loadout      开局配置（不含种子）
  ctx.meta         开考就公开的信息（回合数、审查基准、对手分等）
  ctx.worlds(k)    k 个「可能的世界」：GKMS 会话，隐藏信息（山札顺序、随机数、种子）已重新随机
  ctx.rng          这一局专用的随机数（和游戏随机数无关）

``needs_gkms``：算法要不要本机的 GKMS 引擎（读主数据、要世界、调 GKMS 的搜索）。缺省 False：只看 ctx.obs 出牌，
托管跑（``python -m gkbench eval``）只要装好本包、有令牌，不需要 GKMS。调 ctx.worlds(k) 时会自动加载 GKMS，
所以要世界的算法设 True，开局前就能报出缺什么。

``privileged = True`` 的算法（理论上限）额外拿到 ctx.true_session 和 ctx.seed，成绩单独标出，不参与排名。
``sees_seed = True`` 的算法（游戏官方 AI 这类本来就看真实局面的）也拿到这两样，照常排名，但网页上标「看牌序」，不能托管跑。

``about``（可选）：托管 / 评测时随运行提交的算法说明，显示在网站的运行页和算法排行里：
  {"summary": "一句话思路", "detail": ["分条说明", ...], "sees": "screen",   # screen 只看画面；seed 看种子
   "links": [{"title": "代码仓库", "url": "https://..."}]}
本仓库内置的算法（random / greedy / pimc / uinet / oracle）不用填，服务器按名字给说明。
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Decision:
    action: tuple
    meta: dict = field(default_factory=dict)   # 算法自己附的说明：候选的期望分、理由、用了多少世界……


class Algorithm:
    name = "base"
    title: str | None = None     # 展示名：不传 --label 时网页上显示它（运行编号仍用 name）
    privileged = False
    needs_gkms = False
    sees_seed = False
    about: dict | None = None

    def __init__(self, **params):
        self.params = params

    def describe(self) -> dict:
        return {"name": self.name, "params": self.params, "privileged": self.privileged, "sees_seed": self.sees_seed}

    def begin(self, ctx):
        """一局开始时调用一次。"""

    def decide(self, ctx) -> Decision:
        raise NotImplementedError
