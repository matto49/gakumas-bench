from gkbench.guide_insights import deck_stats, lifts


def rec(score, cards):
    return {"score": score, "deck_cards": [{"produce_card_id": c, "current_upgrade_count": 1, "from_memory": c == "m"} for c in cards]}


def test_deck_stats_counts_whole_deck():
    recs = [rec(100, ["a", "a", "m"]), rec(90, ["a", "b"])]
    d = deck_stats(recs)
    cards = {c["id"]: c for c in d["cards"]}
    assert cards["a"]["share"] == 1.0 and cards["a"]["copies"] == 1.5
    assert cards["m"]["memory"] == 1.0 and cards["b"]["share"] == 0.5
    assert d["size"]["p50"] in (2, 3)


def test_lifts_sign_and_range():
    # 带 x 的 10 份 110 分上下，不带的 10 份 100 分上下；y 人人都带，比不出来
    recs = [rec(110 + i % 2, ["x", "y"]) for i in range(10)] + [rec(100 + i % 2, ["y"]) for i in range(10)]
    ls = {l["id"]: l for l in lifts(recs)}
    assert "y" not in ls
    assert ls["x"]["diff"] > 0 and ls["x"]["se"] > 0 and ls["x"]["share"] == 0.5
