"""出牌助手的码：我们自己的编成码 GA1，和 GKMS 客户端「导出 GKMSUINet」的 GR1（对局码）。"""
import base64
import json
import zlib

import pytest

from gkbench.assist_code import CodeError, pack_ga1, parse_code

LOADOUT = {"produce_id": "produce-008", "round": "final", "idol_card_id": "i_card-shro-3-016",
           "deck": [{"id": "p_card-01-act-3_001", "upgrade": 1}], "params": {"vocal": 1200, "dance": 1500, "visual": 900}}


def gkms_pack(kind, obj):
    """GKMS GakumasCLI/corpus/uinet_export.pack 的算法（GR1 码就是这样打的）"""
    raw = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    c = zlib.compressobj(9, zlib.DEFLATED, -15)
    return kind + "1" + base64.urlsafe_b64encode(c.compress(raw) + c.flush()).decode("ascii").rstrip("=")


def test_ga1_round_trip():
    code = pack_ga1("我的编成", LOADOUT)
    assert code.startswith("GA1")
    got = parse_code(code)
    assert got == {"kind": "GA", "name": "我的编成", "mode": "hif", "loadout": LOADOUT, "seed": None, "plays": []}


def test_ga1_drops_seed():
    got = parse_code(pack_ga1("x", dict(LOADOUT, seed=12345)))
    assert "seed" not in got["loadout"] and got["seed"] is None


def test_gr1_from_gkms():
    plays = [["play", 2], ["select", [0]], ["drink", 1], ["end"]]
    code = gkms_pack("GR", {"n": "本戦 下半場 11-20 01:00", "d": dict(LOADOUT, seed=987654321), "x": plays})
    got = parse_code("  " + code + "\n")              # 粘贴时常带空白
    assert got["kind"] == "GR"
    assert got["name"] == "本戦 下半場 11-20 01:00"
    assert got["seed"] == 987654321
    assert "seed" not in got["loadout"] and got["loadout"]["idol_card_id"] == "i_card-shro-3-016"
    assert got["plays"] == plays


def test_gr1_inside_gkmstest_url():
    """GKMS 也会给出 https://gkmstest.nyarot.org/#c=<码> 这种链接，直接贴链接也认"""
    code = gkms_pack("GR", {"n": "x", "d": dict(LOADOUT, seed=7), "x": []})
    assert parse_code("https://gkmstest.nyarot.org/#c=" + code)["seed"] == 7


@pytest.mark.parametrize("bad", ["", "hello", "GA1!!!!", "ZZ1" + "A" * 20, "GA1" + base64.urlsafe_b64encode(b"not deflate").decode()])
def test_bad_codes(bad):
    with pytest.raises(CodeError):
        parse_code(bad)


def test_rejects_huge_payload():
    big = gkms_pack("GR", {"n": "x", "d": dict(LOADOUT, junk="a" * 300_000), "x": []})
    with pytest.raises(CodeError):
        parse_code(big)


def test_rejects_non_object_loadout():
    with pytest.raises(CodeError):
        parse_code(gkms_pack("GR", {"n": "x", "d": [1, 2], "x": []}))
