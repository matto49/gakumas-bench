"""支援卡目录：从完整主数据（gakumasu-diff，YAML）生成网页「游戏资源一览 · 支援卡」用的 JSON。

    python -m gkbench.supports --master ~/github/_ext/gakumasu-diff \\
        --translation ~/github/_ext/gakumas-master-translation/data --out $GKBENCH_DATA/static/supports.json

GKMS 带的主数据只有考试要用的表，没有支援卡技能（ProduceSkill）和支援卡事件（ProduceStepEventDetail），所以这里读完整主数据。
每张卡：名字、稀有度、属性（Vo / Da / Vi / 辅助）、计划、课程支援（强化手牌的概率）、各突破档的等级上限、
每个技能的解锁等级和各突破档上限等级时的效果（steps：只记会变的那几档）、三个支援卡事件（拿到的技能卡 / P 道具 / 参数）、卡面上的偶像。
文字都带日文和中文（中文取学マス汉化插件的翻译：同一编号的描述片段按顺序拼起来；没有翻译的只有日文）。需要 pyyaml。"""
from __future__ import annotations

import argparse
import json
import subprocess
from collections import defaultdict
from datetime import date
from pathlib import Path

TYPE = {"SupportCardType_Vocal": "vocal", "SupportCardType_Dance": "dance", "SupportCardType_Visual": "visual", "SupportCardType_Assist": "assist"}
PLAN = {"ProducePlanType_Common": "COMMON", "ProducePlanType_Plan1": "PLAN1", "ProducePlanType_Plan2": "PLAN2", "ProducePlanType_Plan3": "PLAN3"}
RARITY = {"SupportCardRarity_Ssr": "SSR", "SupportCardRarity_Sr": "SR", "SupportCardRarity_R": "R"}
PARAM = {"ProduceParameterType_Vocal": "vocal", "ProduceParameterType_Dance": "dance", "ProduceParameterType_Visual": "visual"}
SKILL_TABLES = ("SupportCardProduceSkillLevelVocal", "SupportCardProduceSkillLevelDance",
                "SupportCardProduceSkillLevelVisual", "SupportCardProduceSkillLevelAssist")


def _yaml(master: Path, name: str) -> list[dict]:
    import yaml
    try:
        loader = yaml.CSafeLoader
    except AttributeError:
        loader = yaml.SafeLoader
    with open(master / f"{name}.yaml", encoding="utf-8") as f:
        return yaml.load(f, Loader=loader) or []


def _text(descs) -> str:
    return "".join(d.get("text") or "" for d in descs or []).strip()


def _zh_table(translation: Path | None, name: str, key) -> dict:
    """汉化表：主键 → 拼好的中文。key(row) 给出主键"""
    if not translation or not (translation / f"{name}.json").exists():
        return {}
    raw = json.loads((translation / f"{name}.json").read_text(encoding="utf-8"))
    rows = raw["data"] if isinstance(raw, dict) else raw
    return {key(r): r for r in rows if isinstance(r, dict)}


def _bi(ja: str, zh: str | None) -> dict:
    return {"ja": ja, "zh": zh} if zh and zh != ja else {"ja": ja}


def build(master: Path, translation: Path | None) -> dict:
    cards = _yaml(master, "SupportCard")
    skills = {(r["id"], r["level"]): r for r in _yaml(master, "ProduceSkill")}
    limits: dict[str, list[int]] = defaultdict(list)
    for r in _yaml(master, "SupportCardLevelLimit"):
        limits[r["id"]].append(r["levelLimit"])
    events: dict[str, list[dict]] = defaultdict(list)
    for r in _yaml(master, "ProduceEventSupportCard"):
        events[r["supportCardId"]].append(r)
    details = {r["id"]: r for r in _yaml(master, "ProduceStepEventDetail") if r.get("supportCardId")}
    slots: dict[str, dict[int, list[dict]]] = defaultdict(lambda: defaultdict(list))
    for t in SKILL_TABLES:
        for r in _yaml(master, t):
            slots[r["supportCardId"]][r["order"]].append(r)
    chars = {r["id"]: f'{r.get("lastName", "")}{r.get("firstName", "")}' for r in _yaml(master, "Character")}

    zh_card = _zh_table(translation, "SupportCard", lambda r: r["id"])
    zh_skill = _zh_table(translation, "ProduceSkill", lambda r: (r["id"], r.get("level")))
    zh_event = _zh_table(translation, "ProduceStepEventDetail", lambda r: r["id"])
    zh_char = _zh_table(translation, "Character", lambda r: r["id"])

    out = {}
    for c in cards:
        cid = c["id"]
        caps = sorted(limits.get(c["supportCardLevelLimitId"], []))
        abilities = []
        for order in sorted(slots[cid]):
            rows = sorted(slots[cid][order], key=lambda r: r["supportCardLevel"])
            steps = []   # 各突破档上限等级时生效的那一档；同一档只记一次，网页取「等级 ≤ 上限」的最后一档
            for cap in caps:
                got = [r for r in rows if r["supportCardLevel"] <= cap]
                if not got or (steps and steps[-1]["lv"] == got[-1]["supportCardLevel"]):
                    continue
                r = got[-1]
                sk = skills.get((r["produceSkillId"], r["produceSkillLevel"]))
                ja = _text(sk and sk["produceDescriptions"])
                zh = _text((zh_skill.get((r["produceSkillId"], r["produceSkillLevel"])) or {}).get("produceDescriptions"))
                steps.append({"lv": r["supportCardLevel"]} | _bi(ja, zh))
            abilities.append({"unlock": rows[0]["supportCardLevel"], "steps": steps})
        evs = []
        for e in sorted(events.get(cid, []), key=lambda r: r["number"]):
            d = details.get(e["produceStepEventDetailId"]) or {}
            ent = {"level": e["supportCardLevel"]} | _bi(_text(d.get("produceDescriptions")),
                                                       _text((zh_event.get(e["produceStepEventDetailId"]) or {}).get("produceDescriptions")))
            for desc in d.get("produceDescriptions") or []:
                kind = desc.get("produceDescriptionType")
                if kind == "ProduceDescriptionType_ProduceCard" and desc.get("targetId"):
                    ent["card"] = desc["targetId"]
                elif kind == "ProduceDescriptionType_ProduceItem" and desc.get("targetId"):
                    ent["item"] = desc["targetId"]
            evs.append(ent)
        zc = zh_card.get(cid) or {}
        out[cid] = {
            "name": _bi(c["name"], zc.get("name")),
            "rarity": RARITY.get(c["rarity"], c["rarity"]),
            "type": TYPE.get(c["type"], c["type"]),
            "plan": PLAN.get(c["planType"], c["planType"]),
            "free": bool(c.get("isFree")),
            "limited": bool(c.get("isLimited")),
            "order": c.get("order"),
            "characters": c.get("characterIds") or [],
            "lesson": {"param": PARAM.get(c.get("produceCardUpgradeLessonParameterType")),
                       "permil": c.get("produceCardUpgradePermil") or 0}
            | _bi(_text(c.get("upgradeProduceCardProduceDescriptions")), _text(zc.get("upgradeProduceCardProduceDescriptions"))),
            "caps": caps,
            "abilities": abilities,
            "events": evs,
        }
    names = {i: _bi(n, (zh_char.get(i) or {}).get("lastName", "") + (zh_char.get(i) or {}).get("firstName", "") or None)
             for i, n in chars.items()}
    return {"format": "gkbench.supports.v1", "characters": names, "cards": out}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--master", type=Path, default=Path.home() / "github/_ext/gakumasu-diff")
    ap.add_argument("--translation", type=Path, default=Path.home() / "github/_ext/gakumas-master-translation/data")
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()
    data = build(a.master, a.translation if a.translation.exists() else None)
    commit = subprocess.run(["git", "-C", str(a.master), "log", "-1", "--format=%H %cs"], capture_output=True, text=True).stdout.split()
    data["source"] = {"master": "gakumasu-diff", "commit": commit[0][:12] if commit else None, "master_date": commit[1] if len(commit) > 1 else None,
                      "built": date.today().isoformat()}
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(data['cards'])} 张支援卡 → {a.out}")


if __name__ == "__main__":
    main()
