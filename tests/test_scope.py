"""核心题单：本机跑（管理员 gkbench eval、评测机）和服务器托管评测取同样的题和牌序（server/collections.go evalScope）。"""
from gkbench.client import scope_from

CFG = {"set": "hif", "core": ["A", "B"], "core_seeds": 8}


def test_default_is_core():
    assert scope_from(CFG, None, False, None) == (list(range(8)), ["A", "B"])


def test_old_default_32_capped_to_core():
    assert scope_from(CFG, 32, False, None) == (list(range(8)), ["A", "B"])


def test_fewer_seeds_ok():
    assert scope_from(CFG, 4, False, None) == (list(range(4)), ["A", "B"])


def test_full():
    assert scope_from(CFG, None, True, None) == (list(range(32)), None)


def test_only_overrides_core_problems():
    assert scope_from(CFG, None, False, ["C"]) == (list(range(8)), ["C"])


def test_no_core():
    assert scope_from({"set": "nia"}, None, False, None) == (list(range(32)), None)
