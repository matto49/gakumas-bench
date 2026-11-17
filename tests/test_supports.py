"""支援卡目录：各突破档取「等级 ≤ 上限」的最后一档，事件认出技能卡 / P 道具，中文按编号拼"""
import json

import pytest

yaml = pytest.importorskip("yaml")
from gkbench.supports import build  # noqa: E402

D = lambda t: [{"produceDescriptionType": "ProduceDescriptionType_PlainText", "text": t}]  # noqa: E731


def write(dir, name, rows):
    (dir / f"{name}.yaml").write_text(yaml.safe_dump(rows, allow_unicode=True), encoding="utf-8")


def test_build(tmp_path):
    m, t = tmp_path / "m", tmp_path / "t"
    m.mkdir(), t.mkdir()
    write(m, "SupportCard", [{"id": "s1", "name": "カード", "rarity": "SupportCardRarity_Ssr", "type": "SupportCardType_Dance",
                              "planType": "ProducePlanType_Plan2", "isFree": True, "isLimited": False, "order": 1, "characterIds": ["hski"],
                              "produceCardUpgradeLessonParameterType": "ProduceParameterType_Dance", "produceCardUpgradePermil": 37,
                              "upgradeProduceCardProduceDescriptions": D("/ 確率大"), "supportCardLevelLimitId": "lim"}])
    write(m, "SupportCardLevelLimit", [{"id": "lim", "levelLimit": v} for v in (40, 45, 50, 55, 60)])
    write(m, "ProduceSkill", [{"id": "sk", "level": i, "produceDescriptions": D(f"ダンス+{i}")} for i in (1, 2, 3)])
    for tb in ("Vocal", "Visual", "Assist"):
        write(m, f"SupportCardProduceSkillLevel{tb}", [])
    write(m, "SupportCardProduceSkillLevelDance", [
        {"supportCardId": "s1", "order": 1, "produceSkillId": "sk", "produceSkillLevel": 1, "supportCardLevel": 5},
        {"supportCardId": "s1", "order": 1, "produceSkillId": "sk", "produceSkillLevel": 2, "supportCardLevel": 30},
        {"supportCardId": "s1", "order": 1, "produceSkillId": "sk", "produceSkillLevel": 3, "supportCardLevel": 51}])
    write(m, "ProduceEventSupportCard", [{"supportCardId": "s1", "number": 1, "supportCardLevel": 1, "produceStepEventDetailId": "ev1"}])
    write(m, "ProduceStepEventDetail", [{"id": "ev1", "supportCardId": "s1", "produceDescriptions": [
        {"produceDescriptionType": "ProduceDescriptionType_ProduceCard", "targetId": "p_card-x", "text": "カードX"},
        {"produceDescriptionType": "ProduceDescriptionType_PlainText", "text": "を獲得"}]}])
    write(m, "Character", [{"id": "hski", "lastName": "花海", "firstName": "咲季"}])
    (t / "SupportCard.json").write_text(json.dumps({"rules": {}, "data": [{"id": "s1", "name": "卡",
                                        "upgradeProduceCardProduceDescriptions": [{"text": "/ 概率高"}]}]}, ensure_ascii=False), encoding="utf-8")
    (t / "ProduceSkill.json").write_text(json.dumps({"rules": {}, "data": [{"id": "sk", "level": 3, "produceDescriptions": [
        {"text": "舞蹈"}, {"text": "+3"}]}]}, ensure_ascii=False), encoding="utf-8")

    c = build(m, t)["cards"]["s1"]
    assert c["name"] == {"ja": "カード", "zh": "卡"}
    assert (c["rarity"], c["type"], c["plan"], c["free"]) == ("SSR", "dance", "PLAN2", True)
    assert c["caps"] == [40, 45, 50, 55, 60]
    assert c["lesson"] == {"param": "dance", "permil": 37, "ja": "/ 確率大", "zh": "/ 概率高"}
    # 上限 40～50 都是 Lv30 那档，55、60 是 Lv51 那档；同一档只记一次
    assert c["abilities"] == [{"unlock": 5, "steps": [{"lv": 30, "ja": "ダンス+2"}, {"lv": 51, "ja": "ダンス+3", "zh": "舞蹈+3"}]}]
    assert c["events"] == [{"level": 1, "ja": "カードXを獲得", "card": "p_card-x"}]
