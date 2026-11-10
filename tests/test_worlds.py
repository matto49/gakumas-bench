"""托管模式发给客户端的世界（export_world / import_world）：

- 导出的数据里找不到真种子（三处都要换掉：config.seed、_seed / _loadout["seed"]、核心状态头的 round_seed）
- 客户端重建出来的世界，公开观测和真局面一致，隐藏部分和服务器上采的那个世界一致
- 两边从这个世界推进到底，分数一致
"""
import random
import zlib

import pytest

from gkbench.problems import list_sets, load_set
from gkbench.referee import Referee
from gkbench.worlds import export_world, import_world

pytestmark = pytest.mark.skipif("hif-live" not in list_sets(), reason="缺题集 hif-live")


def _cases():
    out = load_set("hif-live")
    if "gkms480" in list_sets():
        out += load_set("gkms480")[:3]
    return out


@pytest.mark.parametrize("case", _cases(), ids=lambda c: c[0]["id"][:40])
def test_exported_world(case):
    p, seeds = case
    seed = seeds[0]["seed"]
    ref = Referee(p["loadout"], seed)
    rng = random.Random(7)
    for _ in range(4):
        if ref.finished:
            break
        ref.step(rng.choice(ref.legal()))
    if ref.finished:
        pytest.skip("开局几步就结束了")
    world = ref.sample_world(random.Random(11))
    data = export_world(world)
    blob = zlib.decompress(data)
    for pat in (seed.to_bytes(4, "little"), seed.to_bytes(8, "little"), str(seed).encode()):
        assert pat not in blob, "导出的世界里有真种子"

    from uinet.uiobs import from_session
    w2 = import_world(data)
    obs = {k: v for k, v in ref.obs().items() if k != "i"}
    assert from_session(w2, ref.battle.exam, ref.battle.played) == obs
    assert [c["produce_card_id"] for c in w2.deck.deck] == [c["produce_card_id"] for c in world.deck.deck]
    assert w2.deck.rng.state == world.deck.rng.state

    a, b = world.clone(), w2.clone()
    while not a.finished:
        act = tuple(a.legal_actions()[0])
        a.step(act)
        b.step(act)
    assert a.observe()["score"] == b.observe()["score"]
