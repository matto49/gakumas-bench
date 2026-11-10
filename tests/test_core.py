"""裁判、世界采样、重放校验的基本性质。用题集 hif-live 的第一道题（没有题集时跳过）。

  .venv/bin/python -m pytest -q tests
"""
import copy
import random

import pytest

from gkbench import algos
from gkbench.problems import load_set, list_sets
from gkbench.referee import IllegalAction, Referee
from gkbench.runner import play_episode
from gkbench.verify import replay

pytestmark = pytest.mark.skipif("hif-live" not in list_sets(), reason="缺题集 hif-live")


@pytest.fixture(scope="module")
def case():
    p, seeds = load_set("hif-live")[0]
    return p, seeds[0]


def test_same_seed_same_game(case):
    p, row = case
    a, b = Referee(p["loadout"], row["seed"]), Referee(p["loadout"], row["seed"])
    assert a.obs() == b.obs() and a.private_state() == b.private_state()
    for _ in range(5):
        act = a.legal()[0]
        a.step(act)
        b.step(act)
    assert a.obs() == b.obs() and a.private_state() == b.private_state()


def test_obs_has_no_hidden_info(case):
    p, row = case
    r = Referee(p["loadout"], row["seed"])
    o = r.obs()
    text = repr(o)
    assert str(row["seed"]) not in text and str(r.private_state()["rng"]) not in text
    # 山札只给有哪些牌：把真山札打乱，公开观测不变
    s = r.battle.session
    before = copy.deepcopy(o)
    s.edit(lambda v: random.Random(5).shuffle(v.deck.deck))
    assert r.obs() == before


def test_world_keeps_public_and_rerolls_hidden(case):
    p, row = case
    r = Referee(p["loadout"], row["seed"])
    r.step(r.legal()[0])
    truth = r.private_state()
    obs = r.obs()
    rng = random.Random(1)
    orders, rngs = set(), set()
    for _ in range(8):
        w = r.sample_world(rng)
        assert w.config.seed != row["seed"]
        orders.add(tuple(c["produce_card_id"] for c in w.deck.deck))
        rngs.add(w.deck.rng.state)
        from uinet.uiobs import from_session
        wo = from_session(w, r.battle.exam, r.battle.played)
        assert wo == {k: v for k, v in obs.items() if k != "i"}
    assert truth["rng"] not in rngs
    assert len(orders) > 1
    assert r.private_state() == truth          # 采样不改真局面


def test_illegal_action_rejected(case):
    p, row = case
    r = Referee(p["loadout"], row["seed"])
    with pytest.raises(IllegalAction):
        r.step(("play", 99))


def test_episode_replays(case):
    p, row = case
    ep = play_episode(p, row, algos.make("random"), budget=1.0)
    assert ep["err"] is None and ep["final"]["finished"]
    assert replay(p, row["seed"], ep)["ok"]
    bad = copy.deepcopy(ep)
    bad["final"]["score"] += 1
    assert not replay(p, row["seed"], bad)["ok"]
