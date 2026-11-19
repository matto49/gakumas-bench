"""出牌助手的会话（gkbench/assist.py）：实战同步按玩家点的手牌推进，练习模拟引擎自己抽；能撤销、改数值，建议来自 UINet。"""
import collections
import glob
import json
from pathlib import Path

import pytest

from gkbench import engine

PROBLEMS = sorted(glob.glob(str(Path.home() / "github/gakumas-bench-data/problems/hif/*.gksave.json")))
pytestmark = pytest.mark.skipif(not PROBLEMS or not (engine.GKMS_ROOT / "GakumasCLI").is_dir(), reason="缺 GKMS 或 H.I.F 题")


def loadout(i=0):
    return json.load(open(PROBLEMS[i]))["loadout"]


def fake_policy(obs):
    n = len(obs["legal"])
    return {"probs": [1.0 / n] * n, "score_quantiles": {"10%": 1, "50%": 2, "90%": 3}}


def ids(cards):
    return collections.Counter(tuple(c) for c in cards)


@pytest.fixture
def sync():
    from gkbench.assist import AssistSession
    return AssistSession(loadout(), practice=False, seed=11, policy=fake_policy)


def test_sync_waits_for_hand_at_start(sync):
    v = sync.view()
    assert v["awaiting_hand"] is True and v["advice"] is None and v["practice"] is False
    assert v["turn"] == 1 and v["finished"] is False


def test_set_hand_from_deck(sync):
    v = sync.view()
    pool = v["piles"]["hand"] + v["piles"]["deck"]
    want = pool[-3:]                                  # 随便挑三张实际抽到的
    v = sync.set_hand(want)
    assert ids(v["piles"]["hand"]) == ids(want)
    # 没抽到的回牌堆，不进弃牌（支援卡给的强化只在手牌里有效，所以只比卡 id）
    assert collections.Counter(c[0] for c in v["piles"]["hand"] + v["piles"]["deck"]) == collections.Counter(c[0] for c in pool)
    assert v["piles"]["grave"] == []
    assert v["awaiting_hand"] is False
    assert len(v["advice"]["probs"]) == len(v["obs"]["legal"])
    assert 0 <= v["advice"]["best"] < len(v["obs"]["legal"])


def test_support_upgrade_left_in_hand():
    """手里被支援卡强化过的牌，玩家没点它就回牌堆，回去以后不带那层强化"""
    from gkbench.assist import AssistSession
    for i in range(min(8, len(PROBLEMS))):
        for seed in range(1, 25):
            s = AssistSession(loadout(i), practice=False, seed=seed, policy=fake_policy)
            v = s.view()
            hand, deck = v["piles"]["hand"], v["piles"]["deck"]
            plain = [c for c in deck if c[1] == 0]
            if any(c[1] > 0 for c in hand) and len(plain) >= len(hand):
                before_ups = sum(c[1] for c in deck)
                v = s.set_hand(plain[:len(hand)])
                assert sum(c[1] for c in v["piles"]["deck"]) == before_ups
                return
    pytest.fail("前 8 题 × 24 个种子里没找到开局手牌带强化的局")


def test_deck_listing_hides_order(sync):
    d = sync.view()["piles"]["deck"]
    assert d == sorted(d)


def test_unknown_card_rejected(sync):
    from gkbench.assist import AssistError
    with pytest.raises(AssistError):
        sync.set_hand([["p_card-no-such-card", 0]])


def test_step_refused_while_awaiting(sync):
    from gkbench.assist import AssistError
    with pytest.raises(AssistError):
        sync.step(sync.view()["obs"]["legal"][0])


def test_step_and_undo(sync):
    v0 = sync.set_hand(sync.view()["piles"]["hand"])
    act = v0["obs"]["legal"][0]
    v1 = sync.step(act)
    assert v1["can_undo"] is True
    v2 = sync.undo()
    assert v2["obs"] == v0["obs"] and v2["piles"] == v0["piles"] and v2["awaiting_hand"] is False


def test_end_turn_waits_for_next_hand(sync):
    sync.set_hand(sync.view()["piles"]["hand"])
    v = sync.step(("end",))
    assert v["turn"] == 2 and v["awaiting_hand"] is True and v["advice"] is None


def test_set_numbers(sync):
    sync.set_hand(sync.view()["piles"]["hand"])
    v = sync.set_numbers(score=4321, stamina=5, block=12)
    assert (v["score"], v["numbers"]["stamina"], v["numbers"]["block"]) == (4321, 5, 12)


def test_practice_never_waits():
    from gkbench.assist import AssistSession
    s = AssistSession(loadout(), practice=True, policy=fake_policy)
    v = s.view()
    while not v["finished"]:
        assert v["awaiting_hand"] is False and v["advice"] is not None
        v = s.step(v["obs"]["legal"][v["advice"]["best"]])
    assert v["score"] > 0 and v["advice"] is None


def test_matches_referee_on_same_route():
    """实战同步时把引擎自己抽的手牌原样点回去，结果应和裁判同种子同路线一致"""
    from gkbench.assist import AssistSession
    from gkbench.referee import Referee
    ref = Referee(loadout(), 11)
    s = AssistSession(loadout(), practice=False, seed=11, policy=fake_policy)
    for _ in range(12):
        v = s.view()
        if v["finished"]:
            break
        if v["awaiting_hand"]:
            v = s.set_hand(v["piles"]["hand"])
        act = tuple(v["obs"]["legal"][0])
        s.step(act)
        ref.step(act)
    assert s.view()["score"] == ref.score


def test_real_uinet_advice():
    from gkbench.algos.uinet import UinetAlgo
    from gkbench.assist import AssistSession
    pol = UinetAlgo(threads=1).policy
    s = AssistSession(loadout(), practice=True, policy=pol.decide)
    v = s.view()
    assert abs(sum(v["advice"]["probs"]) - 1) < 1e-3 and "50%" in v["advice"]["score_quantiles"]


def _gr1(lo, seed, plays, name="本戦 下半場"):
    import base64, zlib
    raw = json.dumps({"n": name, "d": dict(lo, seed=seed), "x": plays}, ensure_ascii=False, separators=(",", ":")).encode()
    c = zlib.compressobj(9, zlib.DEFLATED, -15)
    return "GR1" + base64.urlsafe_b64encode(c.compress(raw) + c.flush()).decode().rstrip("=")


def _played(seed, n):
    from gkbench.referee import Referee
    ref = Referee(loadout(), seed)
    plays = []
    for _ in range(n):
        a = ref.legal()[-1] if len(plays) % 3 == 2 else ref.legal()[0]      # 夹几次结束回合，走过回合交界
        ref.step(a)
        plays.append(list(a))
    return ref, plays


def test_import_gr1_reaches_same_public_state():
    from gkbench.assist import AssistSession
    ref, plays = _played(4242, 9)
    s = AssistSession.from_code(_gr1(loadout(), 4242, plays), policy=fake_policy)
    v = s.view()
    sess = ref.battle.session
    assert [c[0] for c in v["piles"]["hand"]] == [c["produce_card_id"] for c in sess.deck.hand]
    assert v["score"] == ref.score and v["turn"] == sess.turn
    assert v["numbers"]["stamina"] == sess.state.stamina
    assert v["awaiting_hand"] is False and v["imported"] == {"plays": 9, "total": 9}


def test_import_gr1_scrubs_hidden_info():
    from gkbench.assist import AssistSession
    ref, plays = _played(4242, 6)
    s = AssistSession.from_code(_gr1(loadout(), 4242, plays), policy=fake_policy)
    sess = s.session
    assert int(sess.deck.rng.state) != int(ref.battle.session.deck.rng.state)
    for seed in (getattr(sess, "_seed", None), (getattr(sess, "_loadout", None) or {}).get("seed"),
                 getattr(sess.config, "seed", None), s.battle.loadout.get("seed")):
        assert seed != 4242
    real = [c["produce_card_id"] for c in ref.battle.session.deck.deck]
    if len(real) > 3:
        assert [c["produce_card_id"] for c in sess.deck.deck] != real or len(set(real)) == 1


def test_import_stops_at_unplayable_step():
    from gkbench.assist import AssistSession
    ref, plays = _played(4242, 4)
    s = AssistSession.from_code(_gr1(loadout(), 4242, plays + [["play", 99]]), policy=fake_policy)
    assert s.view()["imported"] == {"plays": 4, "total": 5}


def test_import_ga1_starts_fresh():
    from gkbench.assist import AssistSession
    from gkbench.assist_code import pack_ga1
    s = AssistSession.from_code(pack_ga1("x", loadout()), policy=fake_policy)
    v = s.view()
    assert v["turn"] == 1 and v["awaiting_hand"] is True and v.get("imported") is None


def test_import_gr1_leaves_no_seed_in_native_state():
    """原生核心的状态头（round_seed）和卡的内部编号（scenario-<种子>-n）里也不能留真种子"""
    from gkbench.assist import AssistSession
    seed = 1234567891
    _, plays = _played(seed, 5)
    s = AssistSession.from_code(_gr1(loadout(), seed, plays), policy=fake_policy)
    from GakumasCLI.native.native_session import native_dump
    needle = seed.to_bytes(8, "little", signed=True)
    assert needle not in bytes(s.session._export())
    assert needle not in native_dump(s.session)
    guids = [c.get("guid") for name in ("hand", "deck", "grave", "hold", "lost") for c in getattr(s.session.deck, name)]
    assert guids and not any(str(seed) in str(g) for g in guids)
    v = s.view()                                     # 换完还能接着打
    s.step(v["obs"]["legal"][0])


@pytest.mark.parametrize("patch", [
    {"npc_rng_advances": 9 * 10 ** 18},              # 原生核心里按这个数空转随机数：不设上限一个请求就卡死子进程
    {"npc_rng_advances": -1},
    {"star_bonus_permil": 10 ** 12},
    {"schema": "gkms.tower_loadout.v1"},
    {"produce_id": "produce-003"},
    {"turn_parameter_types": [1] * 500},
])
def test_rejects_unbounded_or_foreign_fields(patch):
    from gkbench.assist import AssistError, check_loadout
    with pytest.raises(AssistError):
        check_loadout(dict(loadout(), **patch))


def test_unknown_fields_dropped():
    from gkbench.assist import check_loadout
    lo = check_loadout(dict(loadout(), whatever={"x": 1}, _private=1))
    assert "whatever" not in lo and "_private" not in lo and lo["idol_card_id"] == loadout()["idol_card_id"]
