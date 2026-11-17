"""首页「现在」用的数据：从完整主数据（gakumasu-diff）算出生日和新卡，写 $GKBENCH_DATA/static/site/home.json。

    python -m gkbench.homedata --master ~/github/_ext/gakumasu-diff \\
        --translation ~/github/_ext/gakumas-master-translation/data --out $GKBENCH_DATA/static/site/home.json

- birthdays：可培育偶像的生日（CharacterDetail 的 Birthday），网页按今天的日期排出「今天 / 接下来」
- new_cards：最近 --days 天里第一次出现在主数据里的偶像卡和支援卡，日期是 gakumasu-diff 那次提交的日期
  （主数据更新的那天，不一定是上线日）。需要完整的 git 历史（clone 时不要 --depth，或先 git fetch --unshallow）
- 名字带日文和中文（中文取学マス汉化插件的翻译；新卡常常还没有翻译）。
卡池、活动这类主数据里没有的东西手写在 static/site/now.json，不归这里管。需要 pyyaml。"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
from datetime import date, timedelta
from pathlib import Path

TOP_ID = re.compile(r"^- id: ['\"]?([^'\"\s]+)", re.M)


def _git(master: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(master), *args], capture_output=True, text=True, check=True).stdout


def _yaml(master: Path, name: str) -> list[dict]:
    import yaml
    loader = getattr(yaml, "CSafeLoader", yaml.SafeLoader)
    with open(master / f"{name}.yaml", encoding="utf-8") as f:
        return yaml.load(f, Loader=loader) or []


def _zh(translation: Path | None, name: str) -> dict[str, dict]:
    if not translation or not (translation / f"{name}.json").exists():
        return {}
    raw = json.loads((translation / f"{name}.json").read_text(encoding="utf-8"))
    rows = raw["data"] if isinstance(raw, dict) else raw
    return {r["id"]: r for r in rows if isinstance(r, dict) and "id" in r}


def _bi(ja: str, zh: str | None) -> dict:
    return {"ja": ja, "zh": zh} if zh and zh != ja else {"ja": ja}


def first_seen(master: Path, file: str, since: date) -> dict[str, str]:
    """file 里每个顶层编号第一次出现的提交日期（只看 since 之后的提交；since 之前就有的不算新）"""
    log = [line.split() for line in _git(master, "log", "--format=%H %cs", "--reverse", "--", file).splitlines()]
    out: dict[str, str] = {}
    prev: set[str] | None = None
    for h, d in log:
        ids = set(TOP_ID.findall(_git(master, "show", f"{h}:{file}")))
        if prev is not None and date.fromisoformat(d) >= since:
            for i in ids - prev:
                out.setdefault(i, d)
        prev = ids if prev is None else prev | ids
    return out


def build(master: Path, translation: Path | None, days: int, today: date) -> dict:
    chars = {r["id"]: r for r in _yaml(master, "Character")}
    zh_char = _zh(translation, "Character")

    def char_name(cid: str) -> dict:
        c = chars.get(cid) or {}
        z = zh_char.get(cid) or {}
        return _bi(f'{c.get("lastName", "")}{c.get("firstName", "")}', (z.get("lastName", "") + z.get("firstName", "")) or None)

    birthdays = []
    for r in _yaml(master, "CharacterDetail"):
        if r.get("type") != "CharacterDetailType_Birthday" or not chars.get(r["characterId"], {}).get("isPlayable"):
            continue
        m = re.match(r"(\d+)月(\d+)日", r.get("content") or "")
        if m:
            birthdays.append({"id": r["characterId"], "name": char_name(r["characterId"]), "month": int(m[1]), "day": int(m[2])})
    birthdays.sort(key=lambda b: (b["month"], b["day"]))

    since = today - timedelta(days=days)
    idols = {r["id"]: r for r in _yaml(master, "IdolCard")}
    supports = {r["id"]: r for r in _yaml(master, "SupportCard")}
    zh_idol, zh_sup = _zh(translation, "IdolCard"), _zh(translation, "SupportCard")
    rar = lambda s: str(s or "").rsplit("_", 1)[-1].upper()  # noqa: E731  IdolCardRarity_Ssr → SSR
    new = []
    for i, d in first_seen(master, "IdolCard.yaml", since).items():
        if i in idols:
            r = idols[i]
            new.append({"kind": "idol", "id": i, "date": d, "rarity": rar(r.get("rarity")), "character": r.get("characterId"),
                        "character_name": char_name(r.get("characterId", "")), "name": _bi(r["name"], (zh_idol.get(i) or {}).get("name"))})
    for i, d in first_seen(master, "SupportCard.yaml", since).items():
        if i in supports:
            r = supports[i]
            new.append({"kind": "support", "id": i, "date": d, "rarity": rar(r.get("rarity")),
                        "name": _bi(r["name"], (zh_sup.get(i) or {}).get("name"))})
    new.sort(key=lambda x: (x["date"], x["kind"] == "idol", x["rarity"] == "SSR", x["id"]), reverse=True)
    head = _git(master, "log", "-1", "--format=%h %cs").split()
    return {
        "format": "gkbench.home.v1",
        "source": {"master": "gakumasu-diff", "commit": head[0], "master_date": head[1], "built": today.isoformat(), "days": days},
        "birthdays": birthdays,
        "new_cards": new,
        "counts": {"idols": len(idols), "supports": len(supports)},
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--master", type=Path, default=Path.home() / "github/_ext/gakumasu-diff")
    ap.add_argument("--translation", type=Path, default=Path.home() / "github/_ext/gakumas-master-translation/data")
    ap.add_argument("--days", type=int, default=60)
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()
    data = build(a.master, a.translation if a.translation.exists() else None, a.days, date.today())
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"生日 {len(data['birthdays'])} 位，最近 {a.days} 天新卡 {len(data['new_cards'])} 张 → {a.out}")


if __name__ == "__main__":
    main()
