"""偶像卡攻略：统计条目（docs/guides.md 第 4 节）、人写条目校验、发布包。"""
import json

from gkbench import guides

IDOL = {"card": "p_card-uniq", "item": "pitem-uniq", "plan": "PLAN2", "style": "EXAM_REVIEW"}
INIT = {"produce-006": ["basic-a", "basic-a", "basic-b"]}


def rec(supports=(), deck=(), memories=(), params=(1000, 500, 300), score=100, items=(), produce="produce-006"):
    return {"produce_id": produce, "score": score, "params": list(params), "produce_item_ids": list(items),
            "support_cards": [{"id": s, "level": lv, "level_limit_rank_number": lim} for s, lv, lim in supports],
            "deck_cards": [{"produce_card_id": c, "current_upgrade_count": up, "from_memory": mem} for c, up, mem in deck],
            "memories": list(memories)}


def entries_by_decision(recs, **kw):
    out = guides.stat_entries("hajime", "i_card-x", recs, idol=IDOL, initial=INIT, fetched="2026-11-19", **kw)
    return {e["decision"]: e for e in out}


def items(entry, key="prefer"):
    return {i["id"]: i["stat"] for i in entry["content"][key]}


def test_stat_entry_identity_scope_and_evidence():
    e = entries_by_decision([rec()])["formation.main_attr"]
    assert e["id"] == "stat.hajime.i_card-x.formation.main_attr"
    assert e["kind"] == "stat"
    assert e["scope"] == {"mode": "hajime", "idol_card": "i_card-x"}
    assert e["evidence"] == [{"kind": "ranking", "mode": "hajime", "n": 1, "fetched": "2026-11-19", "low_sample": True}]


def test_low_sample_flag_only_below_30():
    e = entries_by_decision([rec()] * 30)["formation.main_attr"]
    assert "low_sample" not in e["evidence"][0]


def test_support_share_splits_full_and_nonfull():
    recs = [rec(supports=[("s1", 60, 4)]), rec(supports=[("s1", 40, 2)]), rec(supports=[("s2", 60, 4)]), rec()]
    s = items(entries_by_decision(recs)["formation.support"])
    assert s["s1"] == {"share": 0.5, "share_full": 0.25, "share_nonfull": 0.25, "limit_mean": 3.0, "level_mean": 50.0}
    assert s["s2"]["share_full"] == 0.25 and s["s2"]["share_nonfull"] == 0.0


def test_prefer_sorted_by_share_and_drops_below_5_percent():
    recs = [rec(supports=[("common", 60, 4)]) for _ in range(19)] + [rec(supports=[("common", 60, 4), ("rare", 60, 4)])]
    recs += [rec() for _ in range(1)]
    ids = [i["id"] for i in entries_by_decision(recs)["formation.support"]["content"]["prefer"]]
    assert ids == ["common"]              # rare：1/21 < 5%


def test_main_attr_is_the_highest_param():
    recs = [rec(params=(3000, 1000, 900)), rec(params=(100, 2000, 300)), rec(params=(2500, 100, 100))]
    s = items(entries_by_decision(recs)["formation.main_attr"])
    assert s == {"vo": {"share": round(2 / 3, 3)}, "da": {"share": round(1 / 3, 3)}}


def test_card_pick_skips_unique_initial_and_memory_cards():
    recs = [rec(deck=[("p_card-uniq", 1, False), ("basic-a", 0, False), ("got", 1, False), ("got", 0, False),
                      ("mem", 1, True)]),
            rec(deck=[("got", 0, False), ("mem", 0, False)])]
    s = items(entries_by_decision(recs)["card_pick"])
    assert set(s) == {"got", "mem"}       # 第二份里 mem 不是回忆带入的，算拿到的
    assert s["got"] == {"share": 1.0, "copies": 1.5, "upgraded": round(1 / 3, 3)}
    assert s["mem"] == {"share": 0.5, "copies": 1.0, "upgraded": 0.0}


def test_card_remove_lists_initial_cards_by_kept_rate():
    recs = [rec(deck=[("basic-a", 0, False), ("basic-b", 0, False)]),   # a 留 1/2，b 留 1
            rec(deck=[("basic-b", 0, False)])]                           # a 留 0，b 留 1
    e = entries_by_decision(recs)["card_remove"]
    assert items(e, "avoid") == {"basic-a": {"kept": 0.25}}             # b 全留：不进「先删」
    assert e["content"]["prefer"] == []


def test_card_remove_skipped_without_initial_deck():
    got = entries_by_decision([rec(produce="produce-999")])
    assert "card_remove" not in got


def test_card_upgrade_counts_upgraded_records():
    recs = [rec(deck=[("p_card-uniq", 1, False), ("got", 0, False)]), rec(deck=[("p_card-uniq", 0, False), ("got", 1, False)]),
            rec(deck=[("p_card-uniq", 1, False)])]
    s = items(entries_by_decision(recs)["card_upgrade"])
    assert s["p_card-uniq"] == {"share": round(2 / 3, 3), "upgraded": round(2 / 3, 3)}
    assert s["got"] == {"share": round(1 / 3, 3), "upgraded": 0.5}


def test_memory_and_pitem_from_memories():
    m1 = {"card_id": "mc", "upgrade": 1, "items": ["mi"], "idol_card_id": "i_card-y"}
    m2 = {"card_id": "mc", "upgrade": 0, "items": [], "idol_card_id": "i_card-y"}
    got = entries_by_decision([rec(memories=[m1, m2]), rec(memories=[m2])])
    assert items(got["formation.memory"]) == {"mc": {"share": 1.0, "upgraded": 0.5}}
    assert items(got["formation.pitem"]) == {"mi": {"share": 0.5}}


def test_params_target_quartiles():
    recs = [rec(params=(v, 2 * v, 3 * v)) for v in (100, 200, 300, 400, 500)]
    t = entries_by_decision(recs)["params_target"]["content"]["targets"]
    assert t["vo"] == {"p25": 200, "p50": 300, "p75": 400}
    assert t["vi"]["p50"] == 900


def test_summary_scores_and_final_pitems():
    recs = [rec(score=s, items=["pitem-uniq", "pi"] if s > 2 else ["pitem-uniq"]) for s in range(1, 11)]
    s = guides.summary(recs, idol=IDOL)
    assert (s["n"], s["score_max"], s["score_p50"]) == (10, 10, 5.5)
    assert s["final_pitems"] == [{"id": "pi", "share": 0.8}]            # 固有道具不列


def test_style_and_plan_keys_cover_master_enums():
    assert guides.style_key("EXAM_CARD_PLAY_AGGRESSIVE") == "aggressive"
    assert guides.style_key("PRODUCE_EXAM_EFFECT_TYPE_EXAM_REVIEW") == "review"
    assert guides.plan_key("PLAN3") == "anomaly"


def test_initial_decks_from_master(tmp_path):
    (tmp_path / "ProduceInitialDeck.jsonl").write_text(
        json.dumps({"decoded": {"produceId": "produce-006", "examEffectType": {"name": "PRODUCE_EXAM_EFFECT_TYPE_EXAM_REVIEW"},
                                "examInitialDeckId": "initial_deck-produce_006-review"}}) + "\n", encoding="utf-8")
    (tmp_path / "ExamInitialDeck.jsonl").write_text(
        json.dumps({"id": "initial_deck-produce_006-review", "produceCardIds": ["a", "a", "b"]}) + "\n", encoding="utf-8")
    assert guides.initial_decks(tmp_path) == {("produce-006", "review"): ["a", "a", "b"]}


# ---- 人写条目：校验 ----

def written(**kw):
    e = {"id": "hajime.style-review.card_pick.loop", "kind": "written", "scope": {"mode": "hajime", "style": "review"},
         "decision": "card_pick", "content": {"prefer": ["p_card-a", {"id": "p_card-b", "role": "loop", "keep": 2, "weight": 90}],
                                              "why": "循环件"},
         "evidence": [{"kind": "guide", "ref": "いおん10"}], "updated": "2026-11-20", "by": "bench"}
    e.update(kw)
    return e


def check_one(e, path="hajime/style-review.yaml", known=None):
    return guides.check_entries([(path, e)], known_ids=known)


def test_valid_written_entry_passes():
    assert check_one(written()) == []


def test_path_must_match_scope():
    errs = check_one(written(scope={"mode": "nia", "style": "review"}))
    assert any("scope.mode" in x for x in errs)


def test_id_must_start_with_path_and_decision():
    errs = check_one(written(id="hajime.style-review.card_remove.loop"))
    assert any("id" in x for x in errs)


def test_bad_enums_and_decision():
    assert any("style" in x for x in check_one(written(scope={"mode": "hajime", "style": "yaruki"})))
    assert any("decision" in x for x in check_one(written(decision="buy_drink", id="hajime.style-review.buy_drink.x")))


def test_written_needs_why_and_evidence():
    e = written(evidence=[])
    e["content"] = {"prefer": ["p_card-a"]}
    errs = check_one(e)
    assert any("evidence" in x for x in errs) and any("why" in x for x in errs)


def test_duplicate_ids_rejected():
    e = written()
    assert any("重复" in x for x in guides.check_entries([("hajime/style-review.yaml", e), ("hajime/style-review.yaml", e)]))


def test_unknown_card_ids_rejected_when_catalog_given():
    errs = check_one(written(), known={"p_card-a"})
    assert any("p_card-b" in x for x in errs)


def test_non_card_ids_and_unless_predicates():
    e = written(id="hajime.mode.action.sp", scope={"mode": "hajime"}, decision="action")
    e["content"] = {"prefer": [{"id": "sp_lesson", "attr": "da"}, "rest"], "why": "x",
                    "unless": {"when": {"any": [{"deck_count": {"ids": ["p_card-a"], "gte": 2}}, {"next_exam": "final"}]}, "text": "t"}}
    assert check_one(e, path="hajime/mode.yaml", known={"p_card-a"}) == []
    e["content"]["unless"] = {"when": {"deck_cnt": 1}}
    assert any("谓词" in x for x in check_one(e, path="hajime/mode.yaml"))


def test_level_is_highest_evidence():
    assert guides.level({"evidence": [{"kind": "live"}, {"kind": "ranking"}]}) == "ranking"
    assert guides.level({"evidence": [{"kind": "decision"}, {"kind": "ranking"}]}) == "guide"


def test_load_entries_reads_yaml_lists(tmp_path):
    (tmp_path / "hajime").mkdir()
    (tmp_path / "hajime" / "mode.yaml").write_text("- id: hajime.mode.drink.a\n  kind: written\n", encoding="utf-8")
    assert guides.load_entries(tmp_path) == [("hajime/mode.yaml", {"id": "hajime.mode.drink.a", "kind": "written"})]


# ---- 发布包 ----

def test_pack_merges_mode_and_common_entries_and_versions(tmp_path):
    stats = [{"id": "stat.hajime.i_card-x.card_pick", "kind": "stat", "scope": {"mode": "hajime", "idol_card": "i_card-x"},
              "decision": "card_pick", "content": {"prefer": [], "avoid": []}, "evidence": [{"kind": "ranking"}]}]
    w = [("hajime/mode.yaml", {"id": "a", "scope": {"mode": "hajime"}}), ("nia/mode.yaml", {"id": "b", "scope": {"mode": "nia"}}),
         ("common.yaml", {"id": "c", "scope": {}})]
    m1 = guides.write_pack(tmp_path, "hajime", stats, w, {"i_card-x": {"n": 1}}, sources={"ranking": []}, today="20261120")
    m2 = guides.write_pack(tmp_path, "hajime", stats, w, {}, sources={}, today="20261120")
    assert (m1["packs"]["hajime"]["name"], m2["packs"]["hajime"]["name"]) == ("hajime-20261120-1", "hajime-20261120-2")
    pack = json.loads((tmp_path / "hajime-20261120-1.json").read_text(encoding="utf-8"))
    assert pack["format"] == "gkbench.guides.v1" and pack["schema"] == 1 and pack["version"] == "20261120.1"
    assert sorted(e["id"] for e in pack["entries"]) == ["a", "c", "stat.hajime.i_card-x.card_pick"]
    assert (tmp_path / "hajime.json").read_text(encoding="utf-8") == (tmp_path / "hajime-20261120-2.json").read_text(encoding="utf-8")
    man = json.loads((tmp_path / "manifest.json").read_text(encoding="utf-8"))
    raw = (tmp_path / "hajime-20261120-2.json").read_bytes()
    import hashlib
    assert man["packs"]["hajime"]["sha256"] == hashlib.sha256(raw).hexdigest() and man["schema"] == 1


def test_json_schema_enums_match_code():
    from pathlib import Path
    sch = json.loads((Path(__file__).resolve().parents[1] / "guides/schema/entry.schema.json").read_text(encoding="utf-8"))
    d = sch["$defs"]
    assert set(d["decision"]["enum"]) == set(guides.DECISIONS)
    assert set(d["scope"]["properties"]["style"]["enum"]) == set(guides.STYLES.values())
    assert set(d["evidence"]["properties"]["kind"]["enum"]) == set(guides.LEVEL)


def test_build_cli_writes_pack(tmp_path):
    recs = tmp_path / "recs"
    recs.mkdir()
    (recs / "rec_i_card-x.json").write_text(json.dumps([rec(deck=[("got", 0, False)])]), encoding="utf-8")
    master = tmp_path / "master"
    master.mkdir()
    (master / "IdolCard.jsonl").write_text(json.dumps({"decoded": {
        "id": "i_card-x", "produceCardId": "p_card-uniq", "planType": {"name": "PRODUCE_PLAN_TYPE_PLAN2"},
        "examEffectType": {"name": "PRODUCE_EXAM_EFFECT_TYPE_EXAM_REVIEW"}, "beforeProduceItemId": "pitem-uniq"}}) + "\n", encoding="utf-8")
    (master / "ProduceInitialDeck.jsonl").write_text(json.dumps({"produceId": "produce-006", "examEffectType": {
        "name": "PRODUCE_EXAM_EFFECT_TYPE_EXAM_REVIEW"}, "examInitialDeckId": "d"}) + "\n", encoding="utf-8")
    (master / "ExamInitialDeck.jsonl").write_text(json.dumps({"id": "d", "produceCardIds": ["basic-a"]}) + "\n", encoding="utf-8")
    entries = tmp_path / "entries"
    (entries / "hajime").mkdir(parents=True)
    (entries / "hajime" / "mode.yaml").write_text(
        "- id: hajime.mode.drink.a\n  kind: written\n  scope: {mode: hajime}\n  decision: drink\n"
        "  content: {prefer: [pdrink_00-1-001], why: x}\n  evidence: [{kind: guide, ref: g8}]\n  updated: 2026-11-20\n  by: bench\n",
        encoding="utf-8")
    out = tmp_path / "out"
    guides.main(["build", "--mode", "hajime", "--records", str(recs), "--fetched", "2026-11-19", "--master", str(master),
                 "--entries", str(entries), "--out-dir", str(out), "--today", "20261120"])
    pack = json.loads((out / "hajime-20261120-1.json").read_text(encoding="utf-8"))
    ids = {e["id"] for e in pack["entries"]}
    assert "hajime.mode.drink.a" in ids and "stat.hajime.i_card-x.card_remove" in ids
    assert pack["sources"]["ranking"] == [{"fetch": "recs", "fetched": "2026-11-19", "n_idols": 1}]
    assert pack["summary"]["i_card-x"]["n"] == 1


def test_build_cli_refuses_bad_entries(tmp_path):
    import pytest
    entries = tmp_path / "entries"
    entries.mkdir()
    (entries / "common.yaml").write_text("- id: x\n  kind: written\n", encoding="utf-8")
    with pytest.raises(SystemExit):
        guides.main(["check", str(entries)])


# ---- 偶像之路：按层汇总 ----

def test_tower_summary_per_layer(tmp_path):
    season = tmp_path / "current-20261101"
    season.mkdir()
    hist = [{"score": 10, "memories": [{"idol_card_id": "i_card-a"}, {"idol_card_id": "i_card-b"}]},
            {"score": 20, "memories": [{"idol_card_id": "i_card-a"}]}]
    layer = {"layer": 3, "idols": [{"idol_card_id": "i_card-a", "n": 100, "top": 9, "r5": 5, "r10": 4, "r50": 2, "r100": 1}],
             "conversions": [{"before": "p_card-1", "after": "p_card-2", "count": 7}] * 12, "histories": hist}
    (season / "tower_001-shro.json").write_text(json.dumps({"season": "current-20261101", "tower": "tower_001-shro",
                                                             "total_ranking": {"n": 100}, "layers": [layer]}), encoding="utf-8")
    s = guides.tower_summary(season)
    t = s["towers"]["tower_001-shro"]
    assert s["season"] == "current-20261101" and t["character"] == "shro"
    L = t["layers"][0]
    assert L["layer"] == 3 and L["idols"][0]["idol_card_id"] == "i_card-a"
    assert len(L["conversions"]) == 10
    assert L["memories"] == [{"id": "i_card-a", "share": 1.0}, {"id": "i_card-b", "share": 0.5}]
    assert L["n_histories"] == 2 and "histories" not in L


def test_build_cli_idolroad_packs_layer_summaries(tmp_path):
    root = tmp_path / "decoded"
    for season in ("current-20261101", "previous-20260801"):
        (root / season).mkdir(parents=True)
        (root / season / "tower_001-shro.json").write_text(json.dumps({"tower": "tower_001-shro", "layers": [
            {"layer": 1, "idols": [], "conversions": [], "histories": []}]}), encoding="utf-8")
    out = tmp_path / "out"
    guides.main(["build", "--mode", "idolroad", "--records", str(root), "--fetched", "2026-11-20", "--out-dir", str(out),
                 "--entries", str(tmp_path / "none"), "--today", "20261120"])
    pack = json.loads((out / "idolroad.json").read_text(encoding="utf-8"))
    assert sorted(pack["summary"]["seasons"]) == ["current-20261101", "previous-20260801"]
    assert pack["summary"]["seasons"]["current-20261101"]["towers"]["tower_001-shro"]["layers"][0]["layer"] == 1
    assert pack["entries"] == []


def test_genki_cash_card_class_is_accepted():
    e = written(id="hajime.style-review.card_remove.x", decision="card_remove")
    e["content"] = {"avoid": ["class:genki_cash", "class:other_buff"], "why": "x"}
    assert check_one(e) == []


def test_any_idol_path_is_mode_free_idol_layer():
    e = written(id="any.idol.i_card-shro-3-007.card_pick.x", scope={"idol_card": "i_card-shro-3-007"})
    assert check_one(e, path="any/idol/i_card-shro-3-007.yaml") == []
    bad = written(id="any.idol.i_card-shro-3-007.card_pick.x", scope={"mode": "hif", "idol_card": "i_card-shro-3-007"})
    assert any("mode" in x for x in check_one(bad, path="any/idol/i_card-shro-3-007.yaml"))


# ---- 偶像之路：每层 10 条完整编成的考试卡组 ----

def _master(tmp_path):
    m = tmp_path / "master"
    m.mkdir()
    rows = lambda xs: "\n".join(json.dumps({"decoded": x}) for x in xs)
    (m / "ProduceCard.jsonl").write_text(rows([{"id": "p_card-u", "noDeckDuplication": True}, {"id": "p_card-x"}]))
    (m / "ExamInitialDeck.jsonl").write_text(rows([{"id": "initial_deck-review", "produceCardIds": ["p_card-i1", "p_card-i2"]},
                                                   {"id": "initial_deck-full_power", "produceCardIds": ["p_card-f1", "p_card-f2"]}]))
    (m / "IdolCard.jsonl").write_text(rows([{"id": "i_card-a", "examEffectType": {"name": "PRODUCE_EXAM_EFFECT_TYPE_EXAM_REVIEW"}},
                                            {"id": "i_card-p", "examEffectType": {"name": "PRODUCE_EXAM_EFFECT_TYPE_EXAM_PRESERVATION"}}]))
    return m


def test_tower_deck_follows_formation_rule(tmp_path):
    """主回忆的考试牌 → 各副回忆的（不可重复的卡只留强化最多、再定制最多的那张，留在它自己的位置）→ 2 张初始卡"""
    rules = guides.tower_rules(_master(tmp_path))
    main = {"idol_card_id": "i_card-a", "exam_battle_produce_cards": [
        {"id": "p_card-u"}, {"id": "p_card-x", "upgrade_count": 1,
                             "customizes": [{"id": "p_card_custom-1", "customize_count": 2}]}]}
    sub = {"idol_card_id": "i_card-a", "exam_battle_produce_cards": [{"id": "p_card-x"}, {"id": "p_card-u", "upgrade_count": 1}]}
    assert guides.tower_deck([main, sub], rules) == ["p_card-x+1/p_card_custom-1*2", "p_card-x", "p_card-u+1", "p_card-i1", "p_card-i2"]
    pres = {"idol_card_id": "i_card-p", "exam_battle_produce_cards": [{"id": "p_card-x"}]}
    assert guides.tower_deck([pres], rules)[-2:] == ["p_card-f1", "p_card-f2"]        # 保留流派用全力的初始卡


def test_tower_examples_from_raw_layer(tmp_path):
    rules = guides.tower_rules(_master(tmp_path))
    mem = lambda iid, vo, st, cards: {"user_memory_id": "secret-mem", "idol_card_id": iid, "grade": "RESULT_GRADE_SSS",
                                      "vocal": vo, "dance": 0, "visual": 0, "stamina": st, "exam_battle_produce_cards": cards,
                                      "exam_battle_produce_item_ids": ["pitem-1"] if vo > 100 else ["pitem-sub"]}
    hist = [{"public_user_id": "secret-player", "producer_level": 80, "clear_rank": 3, "score": 50, "play_time": 9,
             "memories": [mem("i_card-a", 1000, 40, [{"id": "p_card-x"}]), mem("i_card-a", 99, 9, [{"id": "p_card-u"}])],
             "produce_card_conversions": [{"before_produce_card_id": "p_card-x", "after_produce_card_id": "p_card-y"}]},
            {"public_user_id": "p2", "score": 90, "clear_rank": 3, "memories": [mem("i_card-a", 500, 30, [])], "produce_card_conversions": []}]
    ex = guides.tower_examples({"layer": 4, "histories": hist}, rules)
    assert [e["score"] for e in ex] == [90, 50]                                         # 按分数降序
    e = ex[1]
    assert e["idol"] == "i_card-a" and e["params"] == [1000 + 19, 0, 0] and e["stamina"] == 40 + 1
    assert e["deck"] == ["p_card-x", "p_card-u", "p_card-i1", "p_card-i2"] and e["items"] == ["pitem-1"]
    assert e["memories"][0] == {"idol": "i_card-a", "grade": "SSS", "vo": 1000, "da": 0, "vi": 0, "stamina": 40}
    assert e["conversions"] == [["p_card-x", "p_card-y"]]
    hist[0]["memories"][0]["grade"] = "RESULT_GRADE_SSS_PLUS"
    assert guides.tower_examples({"histories": hist[:1]}, rules)[0]["memories"][0]["grade"] == "SSS+"
    assert "secret" not in json.dumps(ex)                                               # 不带玩家和回忆的编号


def test_build_cli_idolroad_writes_deck_files(tmp_path):
    decoded, raw = tmp_path / "decoded", tmp_path / "raw"
    (decoded / "current-20261101").mkdir(parents=True)
    (decoded / "current-20261101" / "tower_001-shro.json").write_text(json.dumps({"tower": "tower_001-shro", "layers": [
        {"layer": 1, "idols": [], "conversions": [], "histories": []}]}), encoding="utf-8")
    (raw / "current-20261101" / "tower_001-shro").mkdir(parents=True)
    (raw / "current-20261101" / "tower_001-shro" / "layer_01.json").write_text(json.dumps({"layer": 1, "histories": [
        {"score": 5, "memories": [{"idol_card_id": "i_card-a", "exam_battle_produce_cards": [{"id": "p_card-x"}]}]}]}))
    out = tmp_path / "out"
    guides.main(["build", "--mode", "idolroad", "--records", str(decoded), "--raw", str(raw), "--master", str(_master(tmp_path)),
                 "--fetched", "2026-11-20", "--out-dir", str(out), "--entries", str(tmp_path / "none"), "--today", "20261120"])
    f = out / "idolroad-decks-current-20261101-tower-001-shro.json"
    d = json.loads(f.read_text(encoding="utf-8"))
    assert d["layers"]["1"][0]["deck"][0] == "p_card-x"
    pack = json.loads((out / "idolroad.json").read_text(encoding="utf-8"))
    t = pack["summary"]["seasons"]["current-20261101"]["towers"]["tower_001-shro"]
    assert t["decks"] == "idolroad-decks-current-20261101-tower-001-shro"
