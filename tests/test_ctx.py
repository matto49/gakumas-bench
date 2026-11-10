"""算法拿到的 ctx：本机跑和托管跑公开的东西一样，都不含种子和裁判。"""
import random

from gkbench.client import HostedCtx
from gkbench.runner import Ctx


class _Ref:
    """假裁判：只要 public_meta 和 sample_world"""
    def public_meta(self):
        return {"limit_turn": 9}

    def sample_world(self, rng):
        return ("world", rng.random())


class _Algo:
    def __init__(self, privileged):
        self.privileged = privileged


def _public(obj):
    return {k for k in vars(obj) if not k.startswith("_")}


def test_local_ctx_hides_seed_and_referee():
    ctx = Ctx(_Ref(), {"idol_card_id": "x"}, 2.0, random.Random(1), random.Random(2), _Algo(False), 12345)
    assert not hasattr(ctx, "seed") and not hasattr(ctx, "true_session") and not hasattr(ctx, "ref")
    assert 12345 not in vars(ctx).values()
    assert len(ctx.worlds(3)) == 3 and ctx.worlds_made == 3


def test_local_and_hosted_ctx_expose_the_same_fields():
    local = Ctx(_Ref(), {}, 2.0, random.Random(1), random.Random(2), _Algo(False), 1)
    hosted = HostedCtx.__new__(HostedCtx)
    HostedCtx.__init__(hosted, None, "eid", {"legal": []}, 2.0, {}, {}, random.Random(1))
    assert _public(local) == _public(hosted), (_public(local), _public(hosted))


def test_privileged_ctx_gets_seed():
    class Battle:
        session = "truth"
    ref = _Ref()
    ref.battle = Battle()
    ctx = Ctx(ref, {}, 2.0, random.Random(1), random.Random(2), _Algo(True), 7)
    assert ctx.seed == 7 and ctx.true_session == "truth"
