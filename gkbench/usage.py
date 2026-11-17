"""配置频率：H.I.F 排行榜上每张偶像卡前 100 名的培育记录里，各支援卡 / 技能卡 / P 道具出现的比例。

方法照花吹雪また一年P 的强度榜：抓每张偶像卡的前 100 名配置，按出现频率衡量这张卡和偶像卡合不合、强不强。

    python -m gkbench.usage <数据包目录> --out $GKBENCH_DATA/static/usage/hif.json [--tierboard static/tiers/<id>.json]

数据包目录里读
    03_模拟输入_模板与记录/rec_<偶像卡>.json     解码后的记录：support_card_ids、deck_cards（produce_card_id、current_upgrade_count、customizes）
    06_视频画面_页面与数据/页面数据/cards/<偶像卡>.json 的 histories：支援卡突破档、P 道具
以后自己抓的记录转成同样的格式放进来即可（每张偶像卡一份记录列表）。--tierboard 给了就把强度榜里的技能卡权重（V 模型）一并带上。

输出只有比例和统计量（不含逐份记录）：
    idols.<偶像卡>：n、supports [{id, share, limit}]、cards [{id, share, copies, upgraded, customized, w, in_best}]、items [{id, share, up}]
    supports：用到的支援卡的日文名、中文名、稀有度、属性（网页不必再取整份支援卡目录）
网页按偶像、流派自己汇总：每张偶像卡权重相同，求平均。"""
from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path


def _round(x: float, n: int = 3) -> float:
    return round(x, n)


def card_usage(records: list[dict]) -> list[dict]:
    """技能卡：带这张卡（不分强化）的记录比例、带的话平均几张、强化过 / 定制过的比例"""
    n = len(records)
    has, copies, up, cust = Counter(), Counter(), Counter(), Counter()
    for r in records:
        per = Counter()
        for c in r.get("deck_cards") or []:
            cid = c["produce_card_id"]
            per[cid] += 1
            up[cid] += c.get("current_upgrade_count", 0) > 0
            cust[cid] += bool(c.get("customizes"))
        for cid, k in per.items():
            has[cid] += 1
            copies[cid] += k
    out = []
    for cid, h in has.items():
        total = copies[cid]
        out.append({"id": cid, "share": _round(h / n), "copies": _round(total / h, 2),
                    "upgraded": _round(up[cid] / total), "customized": _round(cust[cid] / total)})
    return sorted(out, key=lambda x: (-x["share"], x["id"]))


def support_usage(histories: list[dict]) -> list[dict]:
    n = len(histories)
    has, lim = Counter(), defaultdict(list)
    for h in histories:
        for s in h.get("support_cards") or []:
            if s.get("id"):
                has[s["id"]] += 1
                if s.get("level_limit_rank_number") is not None:
                    lim[s["id"]].append(s["level_limit_rank_number"])
    return sorted(({"id": k, "share": _round(v / n), "limit": _round(sum(lim[k]) / len(lim[k]), 2) if lim[k] else None}
                   for k, v in has.items()), key=lambda x: (-x["share"], x["id"]))


def item_usage(histories: list[dict], skip: set[str] = frozenset(), names: dict[str, str] | None = None) -> list[dict]:
    """P 道具：带它的记录比例；skip 是人人都有的（H.I.F 固定道具）。
    特训前后是两个编号（名字差一个「+」），一份记录只会带其中一个：按去掉「+」的名字合并，编号取出现最多的那个，up 是特训后的比例"""
    n = len(histories)
    names = names or {}
    key = lambda i: names.get(i, i).rstrip("+")  # noqa: E731
    has, ids, up = Counter(), defaultdict(Counter), Counter()
    for h in histories:
        seen = {}
        for i in set(h.get("produce_item_ids") or []) - skip:
            seen[key(i)] = i
        for k, i in seen.items():
            has[k] += 1
            ids[k][i] += 1
            up[k] += names.get(i, "").endswith("+")
    return sorted(({"id": ids[k].most_common(1)[0][0], "share": _round(v / n), "up": _round(up[k] / v)} for k, v in has.items()),
                  key=lambda x: (-x["share"], x["id"]))


def weights(tier_card: dict | None) -> dict[str, dict]:
    """强度榜 V 模型：同一张卡不同强化 / 定制版本取最高的权重和入选率"""
    out: dict[str, dict] = {}
    for r in (tier_card or {}).get("deck", {}).get("rows", []):
        o = out.setdefault(r["id"], {"w": r["w"], "in_best": r["in_best"]})
        o["w"] = max(o["w"], r["w"])
        o["in_best"] = max(o["in_best"], r["in_best"])
    return out


def build(pkg: Path, tierboard: dict | None, supports_master: dict, skip_items: set[str] = frozenset(),
          item_names: dict[str, str] | None = None) -> dict:
    rec_dir = pkg / "03_模拟输入_模板与记录"
    page_dir = pkg / "06_视频画面_页面与数据" / "页面数据" / "cards"
    tiers = {c["id"]: c for c in (tierboard or {}).get("cards", [])}
    idols = {}
    for f in sorted(rec_dir.glob("rec_*.json")):
        iid = f.stem.removeprefix("rec_")
        recs = json.loads(f.read_text(encoding="utf-8"))
        page = json.loads((page_dir / f"{iid}.json").read_text(encoding="utf-8")) if (page_dir / f"{iid}.json").exists() else {}
        hist = page.get("histories") or [{"support_cards": [{"id": s} for s in r.get("support_card_ids") or []]} for r in recs]
        w = weights(tiers.get(iid))
        cards = card_usage(recs)
        for c in cards:
            if c["id"] in w:
                c.update(w[c["id"]])
        idols[iid] = {"n": len(recs), "produce": sorted({r.get("produce_id") for r in recs if r.get("produce_id")}),
                      "supports": support_usage(hist), "cards": cards, "items": item_usage(hist, skip_items, item_names)}
    used = {s["id"] for v in idols.values() for s in v["supports"]}
    return {"idols": idols, "supports": {k: v for k, v in supports_master.items() if k in used}}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("pkg", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--tierboard", type=Path)
    ap.add_argument("--supports", type=Path, help="static/supports.json（取支援卡名字、稀有度、属性）；默认 --out 上两级的 supports.json")
    ap.add_argument("--catalog", type=Path, help="static/catalog.json（认出 H.I.F 固定道具，统计时去掉）；默认 --out 上两级的 catalog.json")
    ap.add_argument("--author", default="花吹雪また一年P")
    ap.add_argument("--note", default="H.I.F 本戦排行榜前 100 名（理性 · 好印象 31 张偶像卡）")
    a = ap.parse_args()
    sup_path = a.supports or a.out.parent.parent / "supports.json"
    sup = json.loads(sup_path.read_text(encoding="utf-8")) if sup_path.exists() else {"cards": {}}
    master = {k: {"name": v["name"], "rarity": v["rarity"], "type": v["type"], "plan": v["plan"]} for k, v in sup["cards"].items()}
    tb = json.loads(a.tierboard.read_text(encoding="utf-8")) if a.tierboard else None
    cat_path = a.catalog or a.out.parent.parent / "catalog.json"
    cat = json.loads(cat_path.read_text(encoding="utf-8")) if cat_path.exists() else {"items": {}}
    skip = {k for k, v in cat["items"].items() if str(v.get("name", "")).startswith("H.I.F")}
    data = build(a.pkg, tb, master, skip, {k: v.get("name", "") for k, v in cat["items"].items()})
    data = {"format": "gkbench.usage.v1", "mode": "hif",
            "source": {"author": a.author, "note": a.note, "records": sum(v["n"] for v in data["idols"].values()),
                       "built": date.today().isoformat(), "tierboard": tb["id"] if tb else None}, **data}
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(data['idols'])} 张偶像卡、{data['source']['records']} 份记录 → {a.out}")


if __name__ == "__main__":
    main()
