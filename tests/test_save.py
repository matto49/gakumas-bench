"""审查存档格式（gkms.audition_save.v2）的一致性测试。

样例存档放在仓库外的 $GKBENCH_DATA/fixtures/（AS-HM5N7G5Z 是 GKMS-STD-001 附录 B.1 的官方样例，AS-73S73RCH 是 B.2 的
题模板样例）；没有就跳过相关测试。纯格式的测试（紧凑写法边界、记号、算法表）不依赖外部文件。
"""
import copy
import json

import pytest

from gkbench import save
from gkbench.problems import DATA

FIX = DATA / "fixtures"


def _fixture(name):
    p = FIX / f"{name}.gksave.json"
    if not p.is_file():
        pytest.skip(f"缺样例 {p}")
    return json.loads(p.read_text())


@pytest.mark.parametrize("name", ["AS-HM5N7G5Z", "AS-73S73RCH"])
def test_sample_ids_and_read(name):
    doc = _fixture(name)
    r = save.read(doc)
    assert r["id"] == name
    assert r["family"] == "AF-Y5H2AZ7B"              # 两份样例是同一个开局
    assert r["template"] == (name == "AS-73S73RCH")
    # 紧凑写法往返
    assert save.expand_loadout(save.compact_loadout(r["loadout"])) == r["loadout"]
    assert save.compact_loadout(r["loadout"]) == doc["loadout"]


def test_sample_runs_roundtrip():
    doc = _fixture("AS-HM5N7G5Z")
    answers = save.unpack_runs(doc["runs"])
    assert [a["score"] for a in answers] == [523922, 474076, 389728]
    assert answers[0]["mode"] == "player"
    assert answers[1]["mode"] == "internal"
    for a in answers:
        a.pop("mode")                                   # 原件省略了 mode，打包时也不写
    assert save.pack_runs(answers) == doc["runs"]


def test_tamper():
    doc = _fixture("AS-HM5N7G5Z")
    bad = copy.deepcopy(doc)
    bad["loadout"]["starting_stamina"] = 43
    with pytest.raises(save.SaveError, match="编号不符"):
        save.read(bad)


def test_template_rules():
    doc = _fixture("AS-73S73RCH")
    bad = copy.deepcopy(doc)
    t = bad["runs"][0]
    i = t["cols"].index("exam")
    j = t["cols"].index("exam_sha")
    t["rows"][1][i] = t["rows"][1][j] = None            # 题模板的答没有 exam / exam_sha
    with pytest.raises(save.SaveError, match="exam"):
        save.read(bad)


@pytest.mark.parametrize("card,field,compact", [
    ({"produce_card_id": "a", "current_upgrade_count": 0}, "deck_cards", "a"),
    ({"produce_card_id": "a", "current_upgrade_count": 2}, "deck_cards", "a+2"),
    ({"id": "a", "upgrade_count": 0}, "produce_cards", "a+0"),
    ({"id": "a"}, "produce_cards", "a"),
    ({"produce_card_id": "a"}, "deck_cards", None),                                    # 缺强化次数：保留对象
    ({"produce_card_id": "a", "current_upgrade_count": 1, "customizes": []}, "deck_cards", None),
    ({"produce_card_id": "a", "current_upgrade_count": 1, "customizes": [{"id": "c"}]}, "deck_cards", None),
    ({"produce_card_id": "a", "current_upgrade_count": 1, "customizes": [{"id": "c", "customize_count": 1}]},
     "deck_cards", "a+1/c"),
    ({"produce_card_id": "a", "current_upgrade_count": 1, "customizes": [{"id": "c", "customize_count": 2}]},
     "deck_cards", "a+1/c*2"),
    ({"produce_card_id": "a+b", "current_upgrade_count": 0}, "deck_cards", None),      # id 含分隔符
])
def test_card_compact_edges(card, field, compact):
    lo = {field: [card]}
    out = save.compact_loadout(lo)[field][0]
    assert out == (compact if compact is not None else card)
    assert save.expand_loadout({field: [out]})[field][0] == card


def test_tokens():
    acts = [("play", 0), ("drink", 2), ("select", [1, 3]), ("play", 10), ("end",)]
    s = save.route_of(acts)
    assert s == "p0 d2 s1,3 p10 e"
    assert save.parse_route(s) == acts
    for bad in ("p01", " p0", "p0  e", "x1", "s", "s1,"):
        with pytest.raises(save.SaveError):
            save.parse_route(bad)


def test_pack_rules():
    a = {"algo": "external:x", "rules": 55, "score": 1, "at": "20261109T000000Z", "route": "e"}
    with pytest.raises(save.SaveError):
        save.pack_runs([dict(a, budget=1, seconds=2)])
    t = save.pack_runs([dict(a, step_ms=[5]), dict(a, score=2)])
    assert t[0]["cols"] == ["score", "step_ms", "at", "route"]
    assert t[0]["rows"][1][1] is None


# ---------------------------------------------------------------- save make：自己出题
def test_make_template_keeps_id_of_untouched_template():
    doc = _fixture("AS-73S73RCH")
    out = save.make_template(doc)
    assert out["id"] == "AS-73S73RCH" and out["meta"]["family"] == "AF-Y5H2AZ7B"
    assert save.read(out)["template"]


def test_make_template_from_fixed_seed_and_edit():
    fixed = _fixture("AS-HM5N7G5Z")
    out = save.make_template(fixed, name="改过的题")
    assert out["id"] == "AS-73S73RCH"                 # 去掉种子、核对和答，就是同一开局的题模板
    assert out["runs"] == [] and out["check"] == {} and out["prefix"] == ""
    assert "name:改过的题" in out["meta"]["tags"]
    edited = copy.deepcopy(fixed)
    edited["loadout"]["stamina"] = edited["loadout"].get("stamina", 30) + 1   # 手改编成：原编号对不上
    with pytest.raises(save.SaveError, match="编号不符"):
        save.read(edited)
    out2 = save.make_template(edited)
    assert out2["id"] != out["id"] and save.read(out2)["template"]   # 重算后能读


def test_make_template_from_loadout_and_rejects_unknown():
    lo = dict(save.expand_loadout(_fixture("AS-73S73RCH")["loadout"]), schema=save.LOADOUT_SCHEMA)
    lo["seed"] = 12345
    assert save.make_template(lo)["id"] == save.archive_id({k: v for k, v in lo.items() if k != "seed"})
    with pytest.raises(save.SaveError, match="认不出"):
        save.make_template({"deck": []})


def test_make_template_from_compact_loadout():
    doc = _fixture("AS-73S73RCH")
    compact = dict(doc["loadout"], schema=save.LOADOUT_SCHEMA)       # 卡写成字符串的紧凑写法也收，编号和展开写法一样
    assert save.make_template(compact)["id"] == "AS-73S73RCH"
