"""图鉴（网页 /gallery）：每个角色的立绘、偶像卡卡面、相关支援卡、衣装、发型。

    python -m gkbench.gallery --images $GKBENCH_DATA/static/sprites/gallery \\
        --supports $GKBENCH_DATA/static/supports.json --out $GKBENCH_DATA/static/site/gallery.json

图本身由 digital-hiro-research/gkmas-assets/tools/export_gallery.py 从游戏资源导出到 --images（见那个文件的说明）。
这里读完整主数据（gakumasu-diff）的角色、偶像卡、衣装、发型表，配上汉化数据的中文，只列导出了图的条目：
卡面一套一条（偶像卡本身的和「光景」换装的，skin 是换装名），arts 是导出了哪几张（0 特训前、1 特训后、2 第三张）；衣装的 skin 是它来自哪套卡面（cards 里的 id）。
支援卡的名字、稀有度、卡面上的偶像取自已经生成的 supports.json（gkbench.supports）。需要 pyyaml。"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
from datetime import date
from pathlib import Path

RARITY = {"IdolCardRarity_Ssr": "SSR", "IdolCardRarity_Sr": "SR", "IdolCardRarity_R": "R"}


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


def _order(r: dict):
    try:
        return int(r.get("order") or 0)
    except (TypeError, ValueError):
        return 0


def build(master: Path, translation: Path | None, images: Path, supports: dict) -> dict:
    have = lambda p: (images / p).exists()  # noqa: E731

    zc = _zh(translation, "Character")
    chars = {}
    for c in _yaml(master, "Character"):
        z = zc.get(c["id"], {})
        chars[c["id"]] = {"id": c["id"], "name": _bi(f'{c.get("lastName", "")}{c.get("firstName", "")}', (z.get("lastName", "") + z.get("firstName", "")) or None),
                          "stand": have(f'chr/{c["id"]}-full.webp'), "bustup": have(f'chr/{c["id"]}-bustup.webp'),
                          "icon": have(f'chr/{c["id"]}-icon.webp')}

    # 卡面：一套一条。偶像卡本身的卡面和「光景」换装卡面（'24祭 等，挂在某张偶像卡下）都在 IdolCardSkin 表里
    zcard, zskin = _zh(translation, "IdolCard"), _zh(translation, "IdolCardSkin")
    idol = {r["id"]: r for r in _yaml(master, "IdolCard")}
    cards = []
    for sk in sorted(_yaml(master, "IdolCardSkin"), key=_order):
        r = idol.get(sk.get("idolCardId"))
        arts = [v for v in (0, 1, 2) if have(f'card/{sk["assetId"]}_{v}.webp')]
        if not r or not arts:
            continue
        c = {"id": sk["id"], "card": r["id"], "char": r["characterId"], "asset": sk["assetId"], "rarity": RARITY.get(r.get("rarity"), r.get("rarity")),
             "name": _bi(r.get("name", ""), zcard.get(r["id"], {}).get("name")), "arts": arts}
        if sk.get("name"):
            c["skin"] = _bi(sk["name"], zskin.get(sk["id"], {}).get("name"))
        cards.append(c)

    sups = [{"id": sid, "rarity": s.get("rarity"), "name": s.get("name", {"ja": sid}), "chars": s.get("characters", [])}
            for sid, s in supports.get("cards", {}).items() if have(f"support/{sid}.webp")]
    # 新卡在前：s_card-<稀有度>-<编号>，按稀有度、编号倒序
    sups.sort(key=lambda s: tuple(-int(x) for x in re.findall(r"\d+", s["id"])))

    def outfits(table: str, folder: str) -> list[dict]:
        z = _zh(translation, table)
        out = []
        for r in sorted(_yaml(master, table), key=_order):
            if not have(f'{folder}/{r["id"]}.webp'):
                continue
            zr = z.get(r["id"], {})
            o = {"id": r["id"], "char": r.get("characterId"), "name": _bi(r.get("name", ""), zr.get("name")),
                 "desc": _bi(r.get("description", ""), zr.get("description"))}
            if (r.get("targetId") or "").startswith("i_card-skin-"):  # 这套衣装来自哪套卡面（对应 cards 里的 id）
                o["skin"] = r["targetId"]
            out.append(o)
        return out

    costumes, heads = outfits("Costume", "cos"), outfits("CostumeHead", "head")
    used = {c["char"] for c in cards} | {c["char"] for c in costumes} | {c["char"] for c in heads} | {k for k, v in chars.items() if v["stand"] or v["bustup"]}
    return {
        "format": "gkbench.gallery.v1",
        "characters": [c for k, c in chars.items() if k in used],
        "cards": cards, "supports": sups, "costumes": costumes, "heads": heads,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--master", type=Path, default=Path.home() / "github/_ext/gakumasu-diff")
    ap.add_argument("--translation", type=Path, default=Path.home() / "github/_ext/gakumas-master-translation/data")
    ap.add_argument("--images", type=Path, required=True, help="export_gallery.py 的输出目录")
    ap.add_argument("--supports", type=Path, required=True, help="gkbench.supports 生成的 supports.json")
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()
    g = build(a.master, a.translation, a.images, json.loads(a.supports.read_text(encoding="utf-8")))
    commit = subprocess.run(["git", "-C", str(a.master), "log", "-1", "--format=%h %cs"], capture_output=True, text=True).stdout.split()
    g["source"] = {"master": "gakumasu-diff", "commit": commit[0] if commit else None, "master_date": commit[1] if len(commit) > 1 else None,
                   "built": date.today().isoformat()}
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(g, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f'角色 {len(g["characters"])}、偶像卡 {len(g["cards"])}、支援卡 {len(g["supports"])}、衣装 {len(g["costumes"])}、发型 {len(g["heads"])} → {a.out}')


if __name__ == "__main__":
    main()
