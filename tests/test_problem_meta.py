"""题模板的 meta：偶像之路的阶段（层数），上传时记下提交人和来源。要 GKMS 引擎（没有时跳过）。"""
import pytest

try:
    from gkbench import engine
    engine.setup()
    HAVE_GKMS = True
except BaseException:  # noqa: BLE001  setup 缺 GKMS 时 SystemExit
    HAVE_GKMS = False

pytestmark = pytest.mark.skipif(not HAVE_GKMS, reason="没装 GKMS")

TOWER = {
    "schema": "gkms.exam_loadout.v1", "produce_id": "tower", "round": "final", "tower_id": "tower_001-atbm",
    "layer": 11, "mechanic": "exam_concentration", "idol_card_id": "i_card-atbm-1-000", "max_stamina": 43,
    "starting_stamina": 43, "score_bonus_permils": [13960, 28660, 6270],
    "produce_cards": ["p_card-03-ido-1_077+1", "p_card-03-men-2_076", "p_card-03-men-2_080+1", "p_card-03-men-2_077",
                      "p_card-03-men-2_112+1", "p_card-03-act-3_054+1/p_card_custom-070-g_effect-lesson_add-12",
                      "p_card-03-ido-3_238+1", "p_card-00-sup-3_152+1", "p_card-03-act-1_042+1", "p_card-03-men-1_051",
                      "p_card-03-act-2_081+1", "p_card-03-men-2_075+1",
                      "p_card-03-men-1_039+1/p_card_custom-040_040_070-g_effect-block_add-4-g_effect-block_add-8-g_effect-block_add-17*2",
                      "p_card-03-act-3_055+1", "p_card-03-act-3_065+1", "p_card-00-men-3_003", "p_card-00-men-3_005+1",
                      "p_card-03-men-0_015", "p_card-03-act-0_042"],
    "produce_item_ids": ["pitem_03-1-069-0", "pitem_00-3-119-0"],
    "exam": {"exam_effect_type": 45,
             "produce_exam_gimmick_effect_group_id": "p_exam_gimmick-tower_001-exam_concentration-0001-stage_011",
             "produce_exam_battle_config_id": "p_exam_battle_config-tower_001-1126_1877_751-1412_2063_868-turn_20",
             "produce_exam_battle_npc_group_id": "p_npc_group-tower_001-atbm-exam_concentration-stage_011",
             "produce_item_ids": None},
    "open_rounds": 3, "drink_ids": [],
}


def _expanded():
    from gkbench import save
    return save.expand_loadout(dict(TOWER))


def test_tower_stage_is_layer():
    from gkbench.problems import describe
    assert describe(_expanded())["stage"] == "tower.11"


def _template():
    from gkbench import save
    return save.make_archive(_expanded(), meta={"source": {"kind": "manual"}, "tags": ["name:tower-11"]})


def test_upload_defaults_to_uploader():
    from gkbench.problems import check_upload
    rep = check_upload(_template(), by="alice")
    assert rep["meta"]["by"] == "alice"
    assert rep["meta"]["source"] == {"kind": "upload"}
    assert '"by": "alice"' in rep["text"]


def test_upload_keeps_given_source_kind():
    from gkbench.problems import check_upload
    rep = check_upload(_template(), by="yuzeis", source="capture")
    assert rep["meta"]["by"] == "yuzeis"
    assert rep["meta"]["source"] == {"kind": "capture"}


def test_upload_without_by_has_no_by():
    from gkbench.problems import check_upload
    rep = check_upload(_template())
    assert "by" not in rep["meta"]
