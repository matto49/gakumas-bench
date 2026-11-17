"""强度榜导入：把「六维强度榜」数据包（gkms.strength.video.v1）转成网站用的 JSON。

    python -m gkbench.tierboard <数据包目录> --id hif-koinsho-202611 --out $GKBENCH_DATA/static/tiers \\
        --title "H.I.F 模式 · 好印象 强度榜" --author "花吹雪また一年P" --video https://www.bilibili.com/video/BV1mGsJ6AEJ1/

数据包目录里要有 05_导出与榜单/六维总榜/index.json（榜单）和 06_视频画面_页面与数据/页面数据/cards/*.json（单卡页数据）。
输出
    <out>/<id>.json   一张榜：设定、六维权重、档位线、每张卡的汇总（单卡页要的全部数据）
    <out>/index.json  所有榜的目录（每次导入时更新这一项）

只放汇总：收集记录里的支援卡、P 道具、三维只留比例和统计量，逐份的牌组和支援卡不出数据包。
支援卡名字取 GKMS 主数据（SupportCard），有社区中文翻译时一并带上；饮料名字换成编号，网页按目录显示图标。
names：榜上用到的偶像卡、技能卡、P 道具、饮料、支援卡的日文和中文名（取 static/ 下的 catalog.json 和 catalog.zh.json），
网页按「日 / 中」开关选主名，另一种语言做对照。"""
from __future__ import annotations

import argparse
import json
import os
import statistics
from collections import Counter
from datetime import date
from pathlib import Path

DIMS = ("ceiling", "practice", "stability", "card_dep", "formation", "play")


def _table(master: Path, name: str) -> list[dict]:
    out = []
    p = master / f"{name}.jsonl"
    if not p.exists():
        return out
    for line in p.open(encoding="utf-8"):
        try:
            r = json.loads(line)
        except ValueError:
            continue
        out.append(r.get("decoded", r))
    return out


def _zh_names(translation: Path | None, name: str) -> dict[str, str]:
    if not translation:
        return {}
    p = translation / f"{name}.json"
    if not p.exists():
        return {}
    raw = json.loads(p.read_text(encoding="utf-8"))
    rows = raw["data"] if isinstance(raw, dict) else raw
    return {r["id"]: r["name"] for r in rows if isinstance(r, dict) and r.get("id") and r.get("name")}


def _stat(xs: list[float]) -> dict:
    return {"min": min(xs), "max": max(xs), "mean": round(statistics.fmean(xs), 1)}


def usage(histories: list[dict], item_names: dict[str, str], top: int = 8) -> dict:
    """收集记录里带的支援卡、P 道具（同名的强化前后算一种）、牌组张数、支援卡突破档、最终三维"""
    n = len(histories)
    sup = Counter()
    for h in histories:
        sup.update({x["id"] for x in h.get("support_cards") or [] if x.get("id")})
    items: dict[str, list] = {}
    for h in histories:
        seen = {item_names.get(i, i).rstrip("+"): i for i in h.get("produce_item_ids") or []}
        for name, ident in seen.items():
            items.setdefault(name, [0, ident])[0] += 1
    shown = sorted(((v, name, ident) for name, (v, ident) in items.items() if not name.startswith("H.I.F")), reverse=True)
    sizes = sorted(h["deck_size"] for h in histories if h.get("deck_size"))
    limits = Counter(x.get("level_limit_rank_number") for h in histories for x in h.get("support_cards") or [])
    params = {k: _stat([h[k] for h in histories]) for k in ("vocal", "dance", "visual")}
    growth = {k: round(statistics.fmean(h[f"{k}_growth"] for h in histories) / 10, 1) for k in ("vocal", "dance", "visual")}
    return {
        "n": n,
        "supports": [{"id": k, "share": round(v / n, 3)} for k, v in sorted(sup.items(), key=lambda kv: (-kv[1], kv[0]))[:top]],
        "items": [{"id": ident, "share": round(v / n, 3)} for v, _name, ident in shown[:top]],
        "deck_size": [sizes[len(sizes) // 10], sizes[-1 - len(sizes) // 10]] if sizes else None,
        "support_limit": limits.most_common(1)[0][0] if limits else None,
        "params": params,
        "growth": growth,
        "stamina": round(statistics.fmean(h["max_stamina"] for h in histories), 1),
    }


def card_entry(summary: dict, page: dict, names: dict) -> dict:
    """一张偶像卡：榜单里的汇总 + 单卡页的数据，去掉逐份记录"""
    by_name = names["card_by_name"]

    def card_id(name: str) -> str | None:
        return by_name.get(name) or by_name.get(name.rstrip("+"))

    key_cards = {
        side: [dict(k, id=card_id(k["name"])) for k in page["key_cards"][side]]
        for side in ("top", "bottom")
    }
    battles = {}
    for key, b in page["battles"].items():
        b = dict(b)
        if "best_drinks" in b:
            b["best_drinks"] = [names["drink_by_name"].get(x, x) for x in b["best_drinks"]]
        battles[key] = b
    real = dict(page.get("real") or summary.get("real") or {})
    real.update({k: v for k, v in (summary.get("real") or {}).items() if k not in real})
    return {
        **{k: summary[k] for k in ("id", "name", "character", "character_id", "rarity", "plan_label", "style_label",
                                   "rank", "total", "ratio", "tier", "rank_interval", "tier_share", "score", "raw",
                                   "sim", "low_confidence", "vbest_pass") if k in summary},
        "first_share": summary.get("first_share"),
        "confident": page.get("confident"),
        "model": page["model"],
        "counts": page["counts"],
        "real": real,
        "deck": page["deck"],
        "key_cards": key_cards,
        "battles": battles,
        "records": [{k: r[k] for k in ("best", "own", "recorded")} for r in page.get("records") or []],
        "usage": usage(page["histories"], names["item_names"]) if page.get("histories") else None,
    }


def bilingual(cards: list[dict], supports: dict, catalogs: dict[str, dict]) -> dict:
    """榜上用到的偶像卡、技能卡（各强化档）、P 道具、饮料的日文和中文名：网页「日 / 中」切换时主名换语言，另一种做对照"""
    ids = {"idols": set(), "cards": set(), "items": set(), "drinks": set()}
    for c in cards:
        ids["idols"].add(c["id"])
        ids["cards"].update(r["id"] for r in c["deck"]["rows"])
        ids["cards"].update(k["id"] for side in c["key_cards"].values() for k in side if k.get("id"))
        for b in c["battles"].values():
            ids["drinks"].update(b.get("best_drinks") or [])
        if c["usage"]:
            ids["items"].update(x["id"] for x in c["usage"]["items"])
    for lang in ("ja", "zh"):
        idols = catalogs.get(lang, {}).get("idols", {})
        for i in list(ids["idols"]):
            d = idols.get(i) or {}
            ids["cards"].update(x for x in (d.get("card"),) if x)
            ids["items"].update(x for x in (d.get("item"), d.get("item_up")) if x)
    out: dict = {k: {} for k in ids}
    for kind, keys in ids.items():
        for i in sorted(keys):
            entry = {}
            for lang in ("ja", "zh"):
                d = catalogs.get(lang, {}).get(kind, {}).get(i)
                if not d:
                    continue
                if kind == "cards":
                    up = d.get("up") or {}
                    entry[lang] = [up.get(str(u), {}).get("name") or d["name"] + "+" * u for u in range(max(1, len(up)))]
                else:
                    entry[lang] = d["name"]
            if entry:
                out[kind][i] = entry
    out["supports"] = {i: {"ja": s["name"], **({"zh": s["zh"]} if s.get("zh") else {})} for i, s in supports.items()}
    return out


def build(pkg: Path, master: Path, translation: Path | None, meta: dict, catalogs: dict[str, dict] | None = None) -> tuple[dict, dict]:
    board_dir = pkg / "05_导出与榜单" / "六维总榜"
    page_dir = pkg / "06_视频画面_页面与数据" / "页面数据" / "cards"
    index = json.loads((board_dir / "index.json").read_text(encoding="utf-8"))
    if index.get("format") != "gkms.strength.video.v1":
        raise SystemExit(f"不认识的格式：{index.get('format')}")

    cards_master = _table(master, "ProduceCard")
    names = {
        "card_by_name": {},
        "drink_by_name": {d["name"]: d["id"] for d in _table(master, "ProduceDrink")},
        "item_names": {d["id"]: d["name"] for d in _table(master, "ProduceItem")},
    }
    for d in cards_master:
        names["card_by_name"].setdefault(d["name"], d["id"])

    cards = []
    for s in index["cards"]:
        page = json.loads((page_dir / f"{s['id']}.json").read_text(encoding="utf-8"))
        cards.append(card_entry(s, page, names))

    used = {x["id"] for c in cards if c["usage"] for x in c["usage"]["supports"]}
    zh = _zh_names(translation, "SupportCard")
    supports = {}
    for d in _table(master, "SupportCard"):
        if d["id"] in used:
            supports[d["id"]] = {"name": d["name"], "zh": zh.get(d["id"]), "asset": d.get("assetId"),
                                 "rarity": (d.get("rarity") or {}).get("name", "").removeprefix("SUPPORT_CARD_RARITY_")}

    board = {
        "format": "gkbench.tierboard.v1",
        "id": meta["id"],
        "title": meta["title"],
        "scenario": index["scenario"],
        "class": index["class"],
        "source": {k: meta[k] for k in ("author", "video", "date") if meta.get(k)},
        "weights": index["weights"],
        "tier_bars": index["tier_bars"],
        "class_best": index["class_best"],
        "counts": index["counts"],
        "dims": list(DIMS),
        "supports": supports,
        "names": bilingual(cards, supports, catalogs or {}),
        "cards": sorted(cards, key=lambda c: c["rank"]),
    }
    entry = {k: board[k] for k in ("id", "title", "scenario", "class")} | {
        "source": board["source"], "cards": len(cards), "top": [c["id"] for c in board["cards"][:3]]}
    return board, entry


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("pkg", type=Path)
    ap.add_argument("--id", required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--author")
    ap.add_argument("--video")
    ap.add_argument("--date", default=date.today().isoformat())
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--master", type=Path, default=Path(os.environ.get("GKMS_ROOT", Path.home() / "github/_ext/GKMSProject"))
                    / "GakumasCLI/ro/master/tables")
    ap.add_argument("--translation", type=Path, default=Path.home() / "github/_ext/gakumas-master-translation/data")
    ap.add_argument("--catalog", type=Path, help="catalog.json / catalog.zh.json 所在目录，默认 --out 的上一级（static/）")
    a = ap.parse_args()
    cat_dir = a.catalog or a.out.parent
    catalogs = {lang: json.loads((cat_dir / f).read_text(encoding="utf-8"))
                for lang, f in (("ja", "catalog.json"), ("zh", "catalog.zh.json")) if (cat_dir / f).exists()}
    board, entry = build(a.pkg, a.master, a.translation if a.translation.exists() else None, vars(a), catalogs)
    a.out.mkdir(parents=True, exist_ok=True)
    (a.out / f"{a.id}.json").write_text(json.dumps(board, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    idx_path = a.out / "index.json"
    idx = json.loads(idx_path.read_text(encoding="utf-8")) if idx_path.exists() else {"boards": []}
    idx["boards"] = [b for b in idx["boards"] if b["id"] != a.id] + [entry]
    idx_path.write_text(json.dumps(idx, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{a.id}: {len(board['cards'])} 张卡 → {a.out / (a.id + '.json')}")


if __name__ == "__main__":
    main()
