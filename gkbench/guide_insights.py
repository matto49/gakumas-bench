"""偶像卡攻略看板的数据：从排行榜原始记录算「完整牌组」和「带不带这张卡的分差」。

和攻略包（gkbench.guides）分开：攻略包是给数字小广的契约，`card_pick` 不含固有卡、初始牌组、回忆带入的卡；
看板要的是玩家最终实际带着的整副牌，还要分差，这些只给网页用，不进契约。

    python -m gkbench.guide_insights <排行榜目录> <模式> <输出.json> [--fetched 2026-11-18]

排行榜目录 = gakumas-bench-data/private/ranking-decoded/<抓取>/（rec_<偶像卡>.json，每个是一张卡的终局记录列表）。
输出发到服务器 $DATA/static/guides/insights-<模式>.json，网页 GET api/guides/insights-<模式>。

分差的口径：同一张偶像卡的记录里，牌组带这张卡的平均分 − 不带的平均分，除以全部记录的平均分，写成百分比；
附标准误（两组方差各自除以人数再相加开方）。只算带的比例在 10%–90% 之间、两边都至少 8 份的卡：
几乎人人都带或几乎没人带的卡比不出来。排行榜只收前若干名，分数挤在很窄的范围里，又是观察数据
（带某张卡的人可能本来就练度高），所以分差只说明「排行榜上带它的人分数高 / 低」，不是因果。
"""
from __future__ import annotations

import argparse
import json
import math
import statistics
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

FORMAT = "gkbench.guide_insights.v1"
MIN_SIDE = 8          # 带 / 不带两边各至少几份才算分差
SHARE_RANGE = (0.10, 0.90)
DECK_MIN_SHARE = 0.05  # 完整牌组里出现率低于这个的不列


def _r(x: float, n: int = 3) -> float:
    return round(x, n)


def deck_stats(recs: list[dict]) -> dict:
    """整副牌（含固有卡、初始牌组、回忆带入）里每张卡：出现率、带的话平均几张、强化比例、回忆带入的比例。"""
    n = len(recs)
    has, copies, up, mem = Counter(), Counter(), Counter(), Counter()
    sizes = []
    for r in recs:
        cards = r.get("deck_cards") or []
        sizes.append(len(cards))
        per = Counter(c["produce_card_id"] for c in cards)
        for c in cards:
            k = c["produce_card_id"]
            up[k] += (c.get("current_upgrade_count") or 0) > 0
            mem[k] += bool(c.get("from_memory"))
        for k, v in per.items():
            has[k] += 1
            copies[k] += v
    cards = [{"id": k, "share": _r(v / n), "copies": _r(copies[k] / v, 2), "upgraded": _r(up[k] / copies[k]),
              "memory": _r(mem[k] / copies[k])}
             for k, v in has.items() if v / n >= DECK_MIN_SHARE]
    cards.sort(key=lambda c: (-c["share"], -c["copies"], c["id"]))
    q = statistics.quantiles(sizes, n=4, method="inclusive") if len(sizes) >= 2 else [sizes[0]] * 3 if sizes else [0] * 3
    return {"cards": cards, "size": {"p25": round(q[0]), "p50": round(q[1]), "p75": round(q[2])}}


def lifts(recs: list[dict]) -> list[dict]:
    """带这张卡 vs 不带的平均分差（占平均分的比例）和标准误，按分差从高到低。"""
    n = len(recs)
    scores = [r.get("score") or 0 for r in recs]
    mean_all = statistics.mean(scores) if scores else 0
    if n < 2 * MIN_SIDE or mean_all <= 0:
        return []
    has = defaultdict(set)
    for i, r in enumerate(recs):
        for c in r.get("deck_cards") or []:
            has[c["produce_card_id"]].add(i)
    out = []
    for k, idx in has.items():
        m = len(idx)
        if m < MIN_SIDE or n - m < MIN_SIDE or not (SHARE_RANGE[0] <= m / n <= SHARE_RANGE[1]):
            continue
        a = [scores[i] for i in idx]
        b = [scores[i] for i in range(n) if i not in idx]
        diff = statistics.mean(a) - statistics.mean(b)
        se = math.sqrt(statistics.variance(a) / len(a) + statistics.variance(b) / len(b))
        out.append({"id": k, "share": _r(m / n), "diff": _r(diff / mean_all, 4), "se": _r(se / mean_all, 4)})
    out.sort(key=lambda x: (-x["diff"], x["id"]))
    return out


def build(rank_dir: Path, mode: str, fetched: str | None = None) -> dict:
    idols = {}
    for f in sorted(rank_dir.glob("rec_*.json")):
        recs = json.loads(f.read_text())
        if not recs:
            continue
        idols[f.stem[len("rec_"):]] = {"n": len(recs), "deck": deck_stats(recs), "lift": lifts(recs)}
    return {"format": FORMAT, "mode": mode, "fetch": rank_dir.name, "fetched": fetched,
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "idols": idols}


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("rank_dir", type=Path)
    ap.add_argument("mode", choices=["hajime", "nia", "hif"])
    ap.add_argument("out", type=Path)
    ap.add_argument("--fetched", help="抓取日期（页面上显示），例如 2026-11-18")
    a = ap.parse_args(argv)
    data = build(a.rank_dir, a.mode, a.fetched)
    a.out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    print(f"{a.mode}: {len(data['idols'])} 张偶像卡 → {a.out}（{a.out.stat().st_size // 1024} KB）")


if __name__ == "__main__":
    main()
