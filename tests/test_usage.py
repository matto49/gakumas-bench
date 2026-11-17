"""配置频率：按记录数算比例；P 道具特训前后合并、去掉 H.I.F 固定道具"""
from gkbench.usage import card_usage, item_usage, memory_usage, support_usage


def test_card_usage_counts_records_not_copies():
    recs = [{"deck_cards": [{"produce_card_id": "a", "current_upgrade_count": 1}, {"produce_card_id": "a", "current_upgrade_count": 0}]},
            {"deck_cards": [{"produce_card_id": "b", "current_upgrade_count": 0, "from_memory": True}]}]
    got = {c["id"]: c for c in card_usage(recs)}
    assert got["a"] == {"id": "a", "share": 0.5, "copies": 2.0, "upgraded": 0.5, "from_memory": 0.0}
    assert got["b"]["share"] == 0.5 and got["b"]["from_memory"] == 1.0


def test_support_usage_limit_mean():
    h = [{"support_cards": [{"id": "s1", "level_limit_rank_number": 4}]}, {"support_cards": [{"id": "s1", "level_limit_rank_number": 2}, {"id": "s2"}]}]
    assert support_usage(h) == [{"id": "s1", "share": 1.0, "limit": 3.0}, {"id": "s2", "share": 0.5, "limit": None}]


def test_item_usage_merges_upgrade_and_skips_fixed():
    names = {"p-0": "道具", "p-1": "道具+", "hif": "H.I.Fワッペン"}
    h = [{"produce_item_ids": ["p-1", "hif"]}, {"produce_item_ids": ["p-1"]}, {"produce_item_ids": ["p-0"]}, {"produce_item_ids": ["hif"]}]
    assert item_usage(h, {"hif"}, names) == [{"id": "p-1", "share": 0.75, "up": round(2 / 3, 3)}]


def test_memory_usage():
    recs = [{"memories": [{"card_id": "c1", "upgrade": 1, "items": ["i1"]}, {"card_id": "c1", "upgrade": 0, "items": []}]},
            {"memories": [{"card_id": "c2", "upgrade": 0, "items": ["i1"]}]}]
    cards, items = memory_usage(recs)
    assert cards == [{"id": "c1", "share": 0.5, "upgraded": 1.0}, {"id": "c2", "share": 0.5, "upgraded": 0.0}]
    assert items == [{"id": "i1", "share": 1.0}]
