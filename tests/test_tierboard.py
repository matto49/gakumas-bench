"""强度榜导入：收集记录只留比例和统计量，H.I.F 固定道具不算，同名 P 道具的强化前后算一种"""
from gkbench.tierboard import card_entry, usage

H = [
    {"vocal": 1000, "dance": 3000, "visual": 2000, "vocal_growth": 200, "dance_growth": 500, "visual_growth": 300,
     "max_stamina": 40, "deck_size": 22,
     "support_cards": [{"id": "s_a", "level_limit_rank_number": 4}, {"id": "s_b", "level_limit_rank_number": 4}],
     "produce_item_ids": ["p_own-0", "p_hif", "p_x"]},
    {"vocal": 1200, "dance": 2800, "visual": 2400, "vocal_growth": 300, "dance_growth": 600, "visual_growth": 400,
     "max_stamina": 50, "deck_size": 24,
     "support_cards": [{"id": "s_a", "level_limit_rank_number": 3}],
     "produce_item_ids": ["p_own-1", "p_hif"]},
]
NAMES = {"p_own-0": "これでばっちり", "p_own-1": "これでばっちり+", "p_hif": "H.I.F 本番の心得", "p_x": "何か"}


def test_usage_shares_and_stats():
    u = usage(H, NAMES)
    assert u["n"] == 2
    assert u["supports"] == [{"id": "s_a", "share": 1.0}, {"id": "s_b", "share": 0.5}]
    # 强化前后同名算一种；H.I.F 固定道具不列
    assert [x["share"] for x in u["items"]] == [1.0, 0.5]
    assert all(x["id"] != "p_hif" for x in u["items"])
    assert u["params"]["vocal"] == {"min": 1000, "max": 1200, "mean": 1100.0}
    assert u["growth"]["dance"] == 55.0
    assert u["stamina"] == 45.0
    assert u["support_limit"] == 4


def test_card_entry_drops_histories_and_resolves_ids():
    summary = {"id": "i_card-x", "name": "X", "character": "C", "character_id": "c", "rarity": "SSR", "plan_label": "理性",
               "style_label": "好印象", "rank": 1, "total": 80.0, "ratio": 1.0, "tier": "S", "rank_interval": [1, 2],
               "tier_share": {"S": 1.0}, "score": {}, "raw": {}, "sim": {}, "low_confidence": False, "vbest_pass": True,
               "real": {"n": 2, "median": 1.0, "max": 2}}
    page = {"confident": True, "model": {}, "counts": {}, "deck": {"rows": []},
            "key_cards": {"top": [{"name": "カードA+"}], "bottom": []},
            "battles": {"final": {"label": "后战", "best_drinks": ["ソーダ"]}},
            "records": [{"n": 1, "best": 3, "own": 2, "recorded": 1}], "histories": H,
            "real": {"potential": {"1": 2}}}
    names = {"card_by_name": {"カードA": "p_card-a"}, "drink_by_name": {"ソーダ": "pdrink-1"}, "item_names": NAMES}
    e = card_entry(summary, page, names)
    assert "histories" not in e
    assert e["records"] == [{"best": 3, "own": 2, "recorded": 1}]
    assert e["key_cards"]["top"][0]["id"] == "p_card-a"
    assert e["battles"]["final"]["best_drinks"] == ["pdrink-1"]
    assert e["real"]["potential"] == {"1": 2} and e["real"]["median"] == 1.0
