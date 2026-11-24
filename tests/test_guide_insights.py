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


def test_card_customizes_accepts_three_shapes():
    from gkbench.guide_insights import card_customizes
    assert card_customizes({"customizes": [{"id": "d1", "customize_count": 2}]}) == (("d1", 2),)
    assert card_customizes({"customizes": [["d2", 1], ["d1", 2]]}) == (("d1", 2), ("d2", 1))
    assert card_customizes({"customizes": {"d1": 1}}) == (("d1", 1),)
    assert card_customizes({}) == ()


def test_parse_compact():
    from gkbench.guide_insights import parse_compact
    assert parse_compact("p_card-x+1/p_card_custom-a*2/p_card_custom-b") == ("p_card-x", (("p_card_custom-a", 2), ("p_card_custom-b", 1)))
    assert parse_compact("p_card-y") == ("p_card-y", ())


def test_custom_stats():
    from gkbench.guide_insights import CUSTOM_MIN_N, custom_stats
    assert custom_stats([[("a", ())]]) is None  # 没有定制信息
    A2, B1 = (("dA", 2),), (("dB", 1),)
    # 10 份都带 a：6 份选 A 第 2 档，2 份选 B，2 份不定制；其中一份带了两张 a（一张定制一张没定制）只算定制的那张
    decks = [[("a", A2)] for _ in range(5)] + [[("a", A2), ("a", ())]] + [[("a", B1)]] * 2 + [[("a", ())]] * 2
    decks += [[("z", A2)]] * (CUSTOM_MIN_N - 1)  # 带的人不够，不列
    cs = custom_stats(decks)
    a = {c["id"]: c for c in cs["cards"]}["a"]
    assert "z" not in {c["id"] for c in cs["cards"]}
    assert a["n"] == 10 and a["share"] == 0.8
    assert a["combos"][0] == {"c": [["dA", 2]], "share": 0.6}
    assert {"c": [], "share": 0.2} in a["combos"]
    assert a["tiers"] == {"dA*2": 0.6, "dB*1": 0.2}
    assert cs["per_run"]["median"] == 1 and cs["per_run"]["hist"][1] == 10 + CUSTOM_MIN_N - 1 - 2


def test_build_idolroad_pooled(tmp_path):
    import json
    from gkbench.guide_insights import CUSTOM_MIN_N, build_idolroad
    # 偶像卡 A 的记录都带 x（定制），偶像卡 B 的记录都带 y（定制）；pooled 里 x、y 都有
    layers = {"1": [{"idol": "A", "deck": ["p_card-x+1/c1*1"]}] * CUSTOM_MIN_N + [{"idol": "B", "deck": ["p_card-y/c2*1"]}] * CUSTOM_MIN_N}
    (tmp_path / "idolroad-decks-s1-t1.json").write_text(json.dumps({"season": "s1", "layers": layers}))
    d = build_idolroad(tmp_path)
    assert set(d["idols"]) == {"A", "B"}
    assert {c["id"] for c in d["pooled"]["cards"]} == {"p_card-x", "p_card-y"} and d["pooled"]["n"] == 2 * CUSTOM_MIN_N


def test_build_pooled_only_with_customizes(tmp_path):
    import json
    from gkbench.guide_insights import CUSTOM_MIN_N, build
    plain = [{"score": 100, "deck_cards": [{"produce_card_id": "a"}]}] * CUSTOM_MIN_N
    (tmp_path / "rec_i1.json").write_text(json.dumps(plain))
    assert "pooled" not in build(tmp_path, "hif")  # 记录没带定制：不出
    cust = [{"score": 100, "deck_cards": [{"produce_card_id": "a", "customizes": [{"id": "d", "customize_count": 1}]}]}] * CUSTOM_MIN_N
    (tmp_path / "rec_i2.json").write_text(json.dumps(cust))
    d = build(tmp_path, "hif")
    assert d["pooled"]["n"] == 2 * CUSTOM_MIN_N and d["pooled"]["cards"][0]["share"] == 0.5
