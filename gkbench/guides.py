"""偶像卡攻略：从排行榜终局记录生成统计条目，校验人写条目，合并成发布包。格式见 docs/guides.md。

    python -m gkbench.guides stats <记录目录> --mode hajime --fetched 2026-11-19 --out <统计条目.json>
    python -m gkbench.guides check [guides/entries]
    python -m gkbench.guides pack --mode hajime --stats <统计条目.json> --out-dir $GKBENCH_DATA/static/guides

记录目录和 gkbench.usage 相同（gakumas-bench-data/scripts/ranking_decode.py 解出来的 rec_<偶像卡>.json）。
统计只出排行榜能推出的决策点；只发布统计量，不发布逐份记录。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import statistics
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

SCHEMA = 1
MIN_SHARE = 0.05          # 占比低于这个的不列
MAX_ITEMS = 30
LOW_SAMPLE = 30           # 样本少于这个的标 low_sample
KEPT_REMOVED = 0.9        # 初始牌组的卡留存率低于这个才进「先删」
FULL_LIMIT = 4            # 支援卡满凸

STYLES = {"EXAM_REVIEW": "review", "EXAM_CARD_PLAY_AGGRESSIVE": "aggressive", "EXAM_PARAMETER_BUFF": "parameter_buff",
          "EXAM_LESSON_BUFF": "lesson_buff", "EXAM_CONCENTRATION": "concentration", "EXAM_FULL_POWER": "full_power"}
PLANS = {"PLAN1": "sense", "PLAN2": "logic", "PLAN3": "anomaly"}
ATTRS = ("vo", "da", "vi")


def style_key(enum: str | None) -> str | None:
    """主数据 examEffectType（带不带 PRODUCE_EXAM_EFFECT_TYPE_ 前缀都行）→ 条目里的 style。"""
    return STYLES.get((enum or "").removeprefix("PRODUCE_EXAM_EFFECT_TYPE_"))


def plan_key(enum: str | None) -> str | None:
    return PLANS.get((enum or "").removeprefix("PRODUCE_PLAN_TYPE_"))


def initial_decks(master_dir: Path) -> dict[tuple[str, str], list[str]]:
    """(produce_id, style) → 培育开始时的初始牌组（不含偶像固有卡）。主数据 ProduceInitialDeck + ExamInitialDeck。"""
    def rows(name):
        for line in (Path(master_dir) / f"{name}.jsonl").read_text(encoding="utf-8").splitlines():
            if line.strip():
                d = json.loads(line)
                yield d.get("decoded") or d
    decks = {r["id"]: list(r.get("produceCardIds") or []) for r in rows("ExamInitialDeck")}
    out = {}
    for r in rows("ProduceInitialDeck"):
        st = style_key((r.get("examEffectType") or {}).get("name"))
        if st and r.get("examInitialDeckId") in decks:
            out[(r["produceId"], st)] = decks[r["examInitialDeckId"]]
    return out


def _r(x: float, n: int = 3) -> float:
    return round(x, n)


def _ranked(stats: dict[str, dict], key: str = "share") -> list[dict]:
    rows = [{"id": k, "stat": v} for k, v in stats.items() if v[key] >= MIN_SHARE]
    rows.sort(key=lambda x: (-x["stat"][key], x["id"]))
    return rows[:MAX_ITEMS]


def _supports(recs: list[dict]) -> dict[str, dict]:
    n = len(recs)
    has, full, lim, lv = Counter(), Counter(), defaultdict(list), defaultdict(list)
    for r in recs:
        for s in {s["id"]: s for s in r.get("support_cards") or [] if s.get("id")}.values():
            has[s["id"]] += 1
            if s.get("level_limit_rank_number") is not None:
                lim[s["id"]].append(s["level_limit_rank_number"])
                full[s["id"]] += s["level_limit_rank_number"] >= FULL_LIMIT
            if s.get("level") is not None:
                lv[s["id"]].append(s["level"])
    return {k: {"share": _r(v / n), "share_full": _r(full[k] / n), "share_nonfull": _r((v - full[k]) / n),
                "limit_mean": _r(statistics.mean(lim[k]), 2) if lim[k] else None,
                "level_mean": _r(statistics.mean(lv[k]), 1) if lv[k] else None} for k, v in has.items()}


def _main_attr(recs: list[dict]) -> dict[str, dict]:
    c = Counter(ATTRS[max(range(3), key=lambda i: r["params"][i])] for r in recs if len(r.get("params") or []) == 3)
    return {k: {"share": _r(v / len(recs))} for k, v in c.items()}


def _memories(recs: list[dict]) -> tuple[dict, dict]:
    n = len(recs)
    cards, up, its = Counter(), Counter(), Counter()
    for r in recs:
        seen, ups, items = set(), set(), set()
        for m in r.get("memories") or []:
            if m.get("card_id"):
                seen.add(m["card_id"])
                if m.get("upgrade"):
                    ups.add(m["card_id"])
            items.update(m.get("items") or [])
        cards.update(seen)
        up.update(ups)
        its.update(items)
    mem = {k: {"share": _r(v / n), "upgraded": _r(up[k] / v)} for k, v in cards.items()}
    return mem, {k: {"share": _r(v / n)} for k, v in its.items()}


def _own_cards(r: dict) -> list[dict]:
    """培育中自己拿到（不是回忆带进来）的那些卡。"""
    return [c for c in r.get("deck_cards") or [] if not c.get("from_memory")]


def _picks(recs: list[dict], skip: set[str]) -> dict[str, dict]:
    n = len(recs)
    has, copies, up = Counter(), Counter(), Counter()
    for r in recs:
        per = Counter()
        for c in _own_cards(r):
            if c["produce_card_id"] in skip:
                continue
            per[c["produce_card_id"]] += 1
            up[c["produce_card_id"]] += (c.get("current_upgrade_count") or 0) > 0
        for k, v in per.items():
            has[k] += 1
            copies[k] += v
    return {k: {"share": _r(v / n), "copies": _r(copies[k] / v, 2), "upgraded": _r(up[k] / copies[k])} for k, v in has.items()}


def _kept(recs: list[dict], initial: list[str]) -> dict[str, dict]:
    init = Counter(initial)
    kept = defaultdict(list)
    for r in recs:
        have = Counter(c["produce_card_id"] for c in _own_cards(r))
        for k, v in init.items():
            kept[k].append(min(1.0, have[k] / v))
    return {k: {"kept": _r(statistics.mean(v))} for k, v in kept.items()}


def _upgrades(recs: list[dict]) -> dict[str, dict]:
    n = len(recs)
    has_up, copies, up = Counter(), Counter(), Counter()
    for r in recs:
        ups = set()
        for c in _own_cards(r):
            k = c["produce_card_id"]
            copies[k] += 1
            if (c.get("current_upgrade_count") or 0) > 0:
                up[k] += 1
                ups.add(k)
        has_up.update(ups)
    return {k: {"share": _r(v / n), "upgraded": _r(up[k] / copies[k])} for k, v in has_up.items()}


def _quartiles(vals: list[int]) -> dict[str, int]:
    if len(vals) < 2:
        v = vals[0] if vals else 0
        return {"p25": v, "p50": v, "p75": v}
    q = statistics.quantiles(vals, n=4, method="inclusive")
    return {"p25": round(q[0]), "p50": round(q[1]), "p75": round(q[2])}


def stat_entries(mode: str, idol_card: str, recs: list[dict], *, idol: dict | None, initial: dict[str, list[str]],
                 fetched: str) -> list[dict]:
    """一张偶像卡的统计条目。idol：目录里这张偶像卡（取固有卡 card / 固有道具 item）；initial：produce_id → 初始牌组。"""
    if not recs:
        return []
    idol = idol or {}
    ev = {"kind": "ranking", "mode": mode, "n": len(recs), "fetched": fetched}
    if len(recs) < LOW_SAMPLE:
        ev["low_sample"] = True

    def entry(decision, prefer=(), avoid=(), **content):
        return {"id": f"stat.{mode}.{idol_card}.{decision}", "kind": "stat", "scope": {"mode": mode, "idol_card": idol_card},
                "decision": decision, "content": {"prefer": list(prefer), "avoid": list(avoid), **content}, "evidence": [dict(ev)]}

    mem, mem_items = _memories(recs)
    inits = [initial[r.get("produce_id")] for r in recs if r.get("produce_id") in initial]
    skip = {idol.get("card")} | {c for d in inits for c in d}
    out = [entry("formation.main_attr", _ranked(_main_attr(recs))),
           entry("formation.support", _ranked(_supports(recs))),
           entry("formation.memory", _ranked(mem)),
           entry("formation.pitem", _ranked(mem_items)),
           entry("card_pick", _ranked(_picks(recs, skip)))]
    if len(inits) == len(recs):
        removed = [{"id": k, "stat": v} for k, v in _kept(recs, inits[0]).items() if v["kept"] < KEPT_REMOVED]
        out.append(entry("card_remove", avoid=sorted(removed, key=lambda x: (x["stat"]["kept"], x["id"]))))
    out.append(entry("card_upgrade", _ranked(_upgrades(recs))))
    params = [r["params"] for r in recs if len(r.get("params") or []) == 3]
    out.append(entry("params_target", targets={a: _quartiles([p[i] for p in params]) for i, a in enumerate(ATTRS)}))
    return out


def summary(recs: list[dict], *, idol: dict | None) -> dict:
    scores = sorted(r.get("score") or 0 for r in recs)
    skip = {(idol or {}).get("item"), (idol or {}).get("item_up")}
    n = len(recs)
    items = Counter(i for r in recs for i in set(r.get("produce_item_ids") or []) if i not in skip)
    p10 = statistics.quantiles(scores, n=10, method="inclusive")[0] if n >= 2 else (scores[0] if scores else 0)
    return {"n": n, "score_p10": round(p10), "score_p50": statistics.median(scores) if scores else 0,
            "score_max": scores[-1] if scores else 0, "final_pitems": _ranked_plain(items, n)}


def _ranked_plain(c: Counter, n: int) -> list[dict]:
    rows = [{"id": k, "share": _r(v / n)} for k, v in c.items() if v / n >= MIN_SHARE]
    rows.sort(key=lambda x: (-x["share"], x["id"]))
    return rows[:MAX_ITEMS]


# ---- 人写条目：读取和校验（docs/guides.md 第 1、6 节） ----

DECISIONS = ("formation.main_attr", "formation.support", "formation.memory", "formation.pitem", "action", "card_pick",
             "card_remove", "card_upgrade", "drink", "params_target", "exam_style")
LEVEL = {"guide": 3, "decision": 3, "ranking": 2, "live": 1}          # guide = decision > ranking > live（协调 11-20 定）
MODES = ("hajime", "nia", "hif", "idolroad")
DIFFICULTIES = {"hajime": ("regular", "pro", "master", "legend"), "nia": ("pro", "master")}
ACTIONS = ("lesson_vo", "lesson_da", "lesson_vi", "sp_lesson", "oikomi", "class", "outing", "consult", "rest", "allowance",
           "gift", "business", "special_guidance")
CLASSES = ("class:basic", "class:trouble", "class:off_plan", "class:other_buff", "class:genki_cash")
CARD_PREFIXES = ("p_card-", "s_card-", "pitem_", "pdrink_", "i_card-")
PREDICATES = {"deck_count", "deck_has_any", "deck_has_all", "deck_size_gte", "deck_size_lte", "has_pitem", "p_point_lt",
              "stamina_lt", "week_gte", "next_exam"}
ITEM_KEYS = {"id", "role", "weight", "keep", "min_limit", "min_level", "custom", "levels", "full", "upgrade", "attr", "note", "stat"}
EVIDENCE_NEEDS = {"guide": ("ref",), "decision": ("ref",), "ranking": ("mode", "n", "fetched"), "live": ("ref",)}


def level(entry: dict) -> str | None:
    """条目的依据级别：evidence 里最高的一级；decision 和 guide 同级，报成 guide。"""
    ks = [e.get("kind") for e in entry.get("evidence") or [] if e.get("kind") in LEVEL]
    if not ks:
        return None
    best = max(ks, key=lambda k: LEVEL[k])
    return "guide" if best == "decision" else best


def load_entries(root: Path) -> list[tuple[str, dict]]:
    """guides/entries 下所有 YAML：[(相对路径, 条目)]。每个文件是一个条目列表。"""
    import yaml
    root = Path(root)
    out = []
    for f in sorted(root.rglob("*.yaml")):
        rel = f.relative_to(root).as_posix()
        for e in yaml.safe_load(f.read_text(encoding="utf-8")) or []:
            out.append((rel, _plain(e)))
    return out


def _plain(x):
    """YAML 会把 2026-11-20 读成日期：统一转回字符串，条目才能原样写进 JSON。"""
    if isinstance(x, dict):
        return {k: _plain(v) for k, v in x.items()}
    if isinstance(x, list):
        return [_plain(v) for v in x]
    if isinstance(x, (date, datetime)):
        return x.isoformat()
    return x


def scope_of_path(path: str) -> dict | None:
    """文件路径规定的 scope 字段；路径不合规则回 None。"""
    parts = path.removesuffix(".yaml").split("/")
    if parts == ["common"]:
        return {}
    if len(parts) == 2 and parts[0] == "any" and parts[1].startswith("style-"):
        return {"style": parts[1][6:]}
    if len(parts) == 3 and parts[0] == "any" and parts[1] == "idol":
        return {"idol_card": parts[2]}
    if parts[0] not in MODES:
        return None
    if len(parts) == 2:
        if parts[1] == "mode":
            return {"mode": parts[0]}
        for f in ("difficulty", "plan", "style"):
            if parts[1].startswith(f + "-"):
                return {"mode": parts[0], f: parts[1][len(f) + 1:]}
    if len(parts) == 3 and parts[1] == "idol":
        return {"mode": parts[0], "idol_card": parts[2]}
    return None


def _check_pred(p, errs, where):
    if not isinstance(p, dict) or len(p) != 1:
        errs.append(f"{where}: 谓词要写成只有一个键的对象")
        return
    (k, v), = p.items()
    if k in ("all", "any"):
        for q in v if isinstance(v, list) else [None]:
            _check_pred(q, errs, where)
    elif k == "not":
        _check_pred(v, errs, where)
    elif k not in PREDICATES:
        errs.append(f"{where}: 不认识的谓词 {k}")


def _check_item(it, errs, where, known):
    if isinstance(it, str):
        it = {"id": it}
    if not isinstance(it, dict) or not isinstance(it.get("id"), str):
        errs.append(f"{where}: 每一项要有 id")
        return
    extra = set(it) - ITEM_KEYS
    if extra:
        errs.append(f"{where}: 不认识的字段 {sorted(extra)}")
    i = it["id"]
    if i.startswith(CARD_PREFIXES):
        if known is not None and i not in known:
            errs.append(f"{where}: 主数据里查不到 {i}")
    elif i not in ACTIONS and i not in ATTRS and i not in CLASSES:
        errs.append(f"{where}: 不认识的 id {i}")
    if "weight" in it and not (isinstance(it["weight"], (int, float)) and 0 <= it["weight"] <= 100):
        errs.append(f"{where}: weight 要在 0–100")
    if "min_limit" in it and it["min_limit"] not in range(5):
        errs.append(f"{where}: min_limit 要是 0–4")
    if "attr" in it and it["attr"] not in ATTRS:
        errs.append(f"{where}: attr 要是 vo / da / vi")


def _check_scope(sc, errs, where, known):
    if not isinstance(sc, dict):
        errs.append(f"{where}: scope 要是对象")
        return
    mode = sc.get("mode")
    if mode is not None and mode not in MODES:
        errs.append(f"{where}: scope.mode 不认识 {mode}")
    if "difficulty" in sc and sc["difficulty"] not in DIFFICULTIES.get(mode, ()):
        errs.append(f"{where}: scope.difficulty {sc['difficulty']} 不适用于 {mode}")
    if "plan" in sc and sc["plan"] not in PLANS.values():
        errs.append(f"{where}: scope.plan 不认识 {sc['plan']}")
    if "style" in sc and sc["style"] not in STYLES.values():
        errs.append(f"{where}: scope.style 不认识 {sc['style']}（和 examEffectType 一对一：{sorted(STYLES.values())}）")
    if "idol_card" in sc and not str(sc["idol_card"]).startswith("i_card-"):
        errs.append(f"{where}: scope.idol_card 要是 i_card-…")
    if "layer" in sc and (mode != "idolroad" or sc["layer"] not in range(1, 28)):
        errs.append(f"{where}: scope.layer 只用于 idolroad，取 1–27")
    for r in (sc.get("pool") or {}).get("requires") or []:
        _check_item(r, errs, f"{where} pool", known)
    extra = set(sc) - {"mode", "difficulty", "plan", "style", "idol_card", "layer", "pool"}
    if extra:
        errs.append(f"{where}: scope 里不认识的字段 {sorted(extra)}")


def check_entries(entries: list[tuple[str, dict]], known_ids: set[str] | None = None) -> list[str]:
    """人写条目的错误列表（空 = 通过）。known_ids 给了就核对卡 / 道具 / 支援卡 ID 在主数据里。"""
    errs: list[str] = []
    seen: set[str] = set()
    for path, e in entries:
        eid = e.get("id")
        where = f"{path} {eid}"
        if not isinstance(eid, str):
            errs.append(f"{path}: 缺 id")
            continue
        if eid in seen:
            errs.append(f"{where}: id 重复")
        seen.add(eid)
        if e.get("kind") != "written":
            errs.append(f"{where}: 人写条目 kind 要是 written")
        dec = e.get("decision")
        if dec not in DECISIONS:
            errs.append(f"{where}: decision 不认识 {dec}")
        want = scope_of_path(path)
        if want is None:
            errs.append(f"{where}: 文件路径不合规则（见 docs/guides.md 第 6 节）")
        else:
            prefix = path.removesuffix(".yaml").replace("/", ".")
            if not eid.startswith(f"{prefix}.{dec}."):
                errs.append(f"{where}: id 要以 {prefix}.{dec}. 开头")
            sc = e.get("scope") or {}
            for k, v in want.items():
                if sc.get(k) != v:
                    errs.append(f"{where}: scope.{k} 应为 {v}（由文件路径决定）")
            if path.startswith("any/") and "mode" in sc:
                errs.append(f"{where}: any/ 下的条目不写 scope.mode")
        _check_scope(e.get("scope") or {}, errs, where, known_ids)
        c = e.get("content") or {}
        for key in ("prefer", "avoid"):
            for it in c.get(key) or []:
                _check_item(it, errs, f"{where} {key}", known_ids)
        if not c.get("why"):
            errs.append(f"{where}: 人写条目要写 content.why")
        u = c.get("unless")
        if u is not None:
            if not isinstance(u, dict) or not set(u) <= {"when", "text"}:
                errs.append(f"{where}: unless 写成 {{when, text}}")
            elif "when" in u:
                _check_pred(u["when"], errs, f"{where} unless")
        ev = e.get("evidence") or []
        if not ev:
            errs.append(f"{where}: 至少要一条 evidence")
        for x in ev:
            k = x.get("kind")
            if k not in EVIDENCE_NEEDS:
                errs.append(f"{where}: evidence.kind 不认识 {k}")
            else:
                miss = [f for f in EVIDENCE_NEEDS[k] if f not in x]
                if miss:
                    errs.append(f"{where}: {k} 证据缺 {miss}")
        for f in ("updated", "by"):
            if not e.get(f):
                errs.append(f"{where}: 人写条目要写 {f}")
    return errs


# ---- 发布包（docs/guides.md 第 6 节） ----

def _in_mode(scope: dict, mode: str) -> bool:
    return scope.get("mode") in (None, mode)


def write_pack(out_dir: Path, mode: str, stats: list[dict], written: list[tuple[str, dict]], summary_: dict, *,
               sources: dict, today: str | None = None) -> dict:
    """把这个模式的统计条目 + 适用的人写条目写成不可变发布包 <mode>-<日期>-<N>.json，复制一份到 <mode>.json，更新 manifest.json。"""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    today = today or date.today().strftime("%Y%m%d")
    n = 1 + len(list(out_dir.glob(f"{mode}-{today}-*.json")))
    name = f"{mode}-{today}-{n}"
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    entries = [e for _, e in written if _in_mode(e.get("scope") or {}, mode)] + list(stats)
    pack = {"format": "gkbench.guides.v1", "schema": SCHEMA, "mode": mode, "version": f"{today}.{n}", "generated_at": now,
            "sources": sources, "entries": entries, "summary": summary_}
    raw = json.dumps(pack, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    (out_dir / f"{name}.json").write_bytes(raw)
    (out_dir / f"{mode}.json").write_bytes(raw)
    mpath = out_dir / "manifest.json"
    man = json.loads(mpath.read_text(encoding="utf-8")) if mpath.exists() else {"packs": {}}
    man.update(format="gkbench.guides.manifest.v1", schema=SCHEMA, version=f"{today}.{n}", generated_at=now)
    man["packs"][mode] = {"name": name, "version": f"{today}.{n}", "sha256": hashlib.sha256(raw).hexdigest(),
                          "entries": len(entries), "bytes": len(raw)}
    mpath.write_text(json.dumps(man, ensure_ascii=False, indent=1), encoding="utf-8")
    return man


# ---- 偶像之路：按层汇总（排行榜只有每层前 5 名牌组和 10 条编成，出不了选卡 / 删卡条目） ----

def tower_summary(season_dir: Path) -> dict:
    """tower-ranking-decoded/<赛季>/<塔>.json → {season, towers: {塔: {character, total, layers: [{layer, idols, conversions,
    memories, n_histories}]}}}。memories：这一层编成（histories）里用到各偶像卡回忆的比例；不带逐条编成。"""
    season_dir = Path(season_dir)
    towers = {}
    for f in sorted(season_dir.glob("tower_*.json")):
        t = json.loads(f.read_text(encoding="utf-8"))
        layers = []
        for L in t.get("layers") or []:
            hist = L.get("histories") or []
            mem = Counter(i for h in hist for i in {m.get("idol_card_id") for m in h.get("memories") or []} if i)
            layers.append({"layer": L["layer"], "idols": L.get("idols") or [], "conversions": (L.get("conversions") or [])[:10],
                           "memories": _ranked_plain(mem, len(hist)) if hist else [], "n_histories": len(hist)})
        tid = t.get("tower") or f.stem
        towers[tid] = {"character": tid.rsplit("-", 1)[-1], "total": t.get("total_ranking"), "layers": layers}
    return {"season": season_dir.name, "towers": towers}

# ---- 偶像之路：每层 10 条完整编成（ListLayerPlayerHistories，原始数据 tower-ranking/<赛季>/<塔>/layer_NN.json） ----
# 开局卡组的拼法（GKMS rev383 docs/idol_road_master.md「Memory formation」，GKMS 拿它和真实 Tower/Start 逐项对过）：
# 主回忆的考试牌，再按槽位接各副回忆的；ProduceCard.noDeckDuplication 的卡只留一张（强化最多、再定制最多、再靠前的那张，
# 留在它自己的位置）；最后接 ExamInitialDeck initial_deck-<流派> 的 2 张。三维和体力 = 主 + 每个副回忆的 20%（向下取整）。
# 换卡（produce_card_conversions）不进开局卡组，单独列。

TOWER_THEME = dict(STYLES, EXAM_PRESERVATION="full_power")   # 保留流派用全力的初始卡


def _master_rows(master_dir: Path, name: str):
    for line in (Path(master_dir) / f"{name}.jsonl").read_text(encoding="utf-8").splitlines():
        if line.strip():
            d = json.loads(line)
            yield d.get("decoded") or d


def tower_rules(master_dir: Path) -> dict:
    """拼卡组要的主数据：不可重复的卡、各流派的 2 张初始卡、偶像卡 → 流派。"""
    no_dup = {r["id"] for r in _master_rows(master_dir, "ProduceCard") if r.get("noDeckDuplication")}
    initial = {r["id"].removeprefix("initial_deck-"): list(r.get("produceCardIds") or [])
               for r in _master_rows(master_dir, "ExamInitialDeck") if str(r.get("id", "")).startswith("initial_deck-")}
    theme = {r["id"]: TOWER_THEME.get(((r.get("examEffectType") or {}).get("name") or "").removeprefix("PRODUCE_EXAM_EFFECT_TYPE_"))
             for r in _master_rows(master_dir, "IdolCard")}
    return {"no_dup": no_dup, "initial": initial, "theme": theme}


def _card_str(c: dict) -> str:
    """{"id", "upgrade_count", "customizes"} → 卡组写法 id+强化/定制方向*次数（和题库的 deck_cards 一样）"""
    up = int(c.get("upgrade_count") or 0)
    cz = "".join(f"/{x['id']}" + (f"*{int(x['customize_count'])}" if int(x.get("customize_count") or 1) > 1 else "")
                 for x in c.get("customizes") or () if int(x.get("customize_count") or 0) > 0)
    return c["id"] + (f"+{up}" if up else "") + cz


def tower_deck(memories: list[dict], rules: dict) -> list[str]:
    """主回忆在前、副回忆按槽位 → 开局卡组（卡组写法）。"""
    no_dup = rules["no_dup"]
    best = {}
    for n, m in enumerate(memories):
        for i, c in enumerate(m.get("exam_battle_produce_cards") or ()):
            if c["id"] in no_dup:
                rank = (int(c.get("upgrade_count") or 0), sum(int(x.get("customize_count") or 0) for x in c.get("customizes") or ()))
                if c["id"] not in best or rank > best[c["id"]][0]:
                    best[c["id"]] = (rank, (n, i))
    kept = {slot for _, slot in best.values()}
    deck = [_card_str(c) for n, m in enumerate(memories) for i, c in enumerate(m.get("exam_battle_produce_cards") or ())
            if c["id"] not in no_dup or (n, i) in kept]
    theme = rules["theme"].get(memories[0].get("idol_card_id")) if memories else None
    return deck + list(rules["initial"].get(theme or "", []))


def tower_examples(layer: dict, rules: dict) -> list[dict]:
    """原始数据的一层 → 这一层的完整编成（按分数降序）。不带玩家和回忆的编号。"""
    out = []
    for h in layer.get("histories") or []:
        ms = h.get("memories") or []
        if not ms:
            continue
        main, subs = ms[0], ms[1:]
        share = lambda k: int(main.get(k) or 0) + sum(int(s.get(k) or 0) * 200 // 1000 for s in subs)
        out.append({
            "score": h.get("score"), "clear_rank": h.get("clear_rank"), "producer_level": h.get("producer_level"),
            "idol": main.get("idol_card_id"),
            "memories": [{"idol": m.get("idol_card_id"), "grade": str(m.get("grade") or "").removeprefix("RESULT_GRADE_").replace("_PLUS", "+"),
                          "vo": m.get("vocal"), "da": m.get("dance"), "vi": m.get("visual"), "stamina": m.get("stamina")} for m in ms],
            "params": [share("vocal"), share("dance"), share("visual")], "stamina": share("stamina"),
            "deck": tower_deck(ms, rules), "items": list(main.get("exam_battle_produce_item_ids") or []),
            "conversions": [[c.get("before_produce_card_id"), c.get("after_produce_card_id")] for c in h.get("produce_card_conversions") or []],
        })
    out.sort(key=lambda e: -(e["score"] or 0))
    return out


def tower_deck_files(raw_season: Path, rules: dict) -> dict[str, dict]:
    """原始数据的一个赛季 → {塔: {"layers": {层: [编成…]}}}（只收有编成的层）"""
    towers = {}
    for tdir in sorted(Path(raw_season).iterdir()):
        if not tdir.is_dir():
            continue
        layers = {}
        for f in sorted(tdir.glob("layer_*.json")):
            L = json.loads(f.read_text(encoding="utf-8"))
            ex = tower_examples(L, rules)
            if ex:
                layers[str(int(L.get("layer") or f.stem.removeprefix("layer_")))] = ex
        if layers:
            towers[tdir.name] = {"layers": layers}
    return towers


def deck_file_name(season: str, tower: str) -> str:
    """网站按 guides/<名字>.json 取，名字只许小写字母、数字、连字符"""
    return re.sub(r"[^a-z0-9-]", "-", f"idolroad-decks-{season}-{tower}".lower())

# ---- 命令行 ----

def idol_meta(master_dir: Path) -> dict[str, dict]:
    """偶像卡 → {card 固有卡, item / item_up 固有道具, plan, style}（主数据 IdolCard）。"""
    out = {}
    p = Path(master_dir) / "IdolCard.jsonl"
    for line in p.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        d = json.loads(line)
        d = d.get("decoded") or d
        out[d["id"]] = {"card": d.get("produceCardId"), "item": d.get("beforeProduceItemId"), "item_up": d.get("afterProduceItemId"),
                        "plan": plan_key((d.get("planType") or {}).get("name")),
                        "style": style_key((d.get("examEffectType") or {}).get("name"))}
    return out


def known_ids(static: Path) -> set[str] | None:
    """网站目录（catalog.json + supports.json）里有的 ID；目录不在就回 None（不核对 ID）。"""
    cat = Path(static) / "catalog.json"
    if not cat.exists():
        return None
    c = json.loads(cat.read_text(encoding="utf-8"))
    ids = {k for part in ("cards", "items", "drinks", "idols") for k in c.get(part) or {}}
    sup = Path(static) / "supports.json"
    if sup.exists():
        ids |= set(json.loads(sup.read_text(encoding="utf-8")).get("cards") or {})
    return ids


def _check_or_exit(entries, static):
    errs = check_entries(entries, known_ids(static) if static else None)
    if errs:
        print("\n".join(errs))
        raise SystemExit(f"{len(errs)} 处错误")
    return entries


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    ck = sub.add_parser("check", help="校验人写条目")
    ck.add_argument("entries", type=Path, nargs="?", default=Path(__file__).resolve().parents[1] / "guides/entries")
    ck.add_argument("--static", type=Path, help="网站数据目录（$GKBENCH_DATA/static），给了就核对 ID")
    b = sub.add_parser("build", help="生成一个模式的统计条目，和人写条目合并成发布包")
    b.add_argument("--mode", required=True, choices=["hajime", "nia", "hif", "idolroad"])
    b.add_argument("--records", type=Path, required=True, help="rec_<偶像卡>.json 所在目录；idolroad 是 tower-ranking-decoded（下面每个赛季一个目录）")
    b.add_argument("--raw", type=Path, help="idolroad：tower-ranking 原始数据目录（带每层 10 条完整编成），要和 --master 一起给")
    b.add_argument("--fetched", required=True, help="排行榜抓取日期 YYYY-MM-DD")
    b.add_argument("--master", type=Path, help="主数据表目录（IdolCard / ProduceInitialDeck / ExamInitialDeck .jsonl）")
    b.add_argument("--entries", type=Path, default=Path(__file__).resolve().parents[1] / "guides/entries")
    b.add_argument("--out-dir", type=Path, required=True, help="$GKBENCH_DATA/static/guides")
    b.add_argument("--static", type=Path)
    b.add_argument("--today", help="发布日期 YYYYMMDD（默认今天）")
    a = ap.parse_args(argv)
    if a.cmd == "check":
        es = _check_or_exit(load_entries(a.entries) if a.entries.exists() else [], a.static)
        print(f"{len(es)} 条人写条目，通过")
        return
    written = _check_or_exit(load_entries(a.entries) if a.entries.exists() else [], a.static)
    if a.mode == "idolroad":
        seasons = {d.name: tower_summary(d) for d in sorted(a.records.iterdir()) if d.is_dir()}
        if a.raw and a.master:                       # 每座塔一个编成文件，点开一层时网页再取
            rules = tower_rules(a.master)
            a.out_dir.mkdir(parents=True, exist_ok=True)
            for name, sv in seasons.items():
                if not (a.raw / name).is_dir():
                    continue
                for tid, body in tower_deck_files(a.raw / name, rules).items():
                    if tid not in sv["towers"]:
                        continue
                    fn = deck_file_name(name, tid)
                    (a.out_dir / f"{fn}.json").write_text(json.dumps({"season": name, "tower": tid, **body}, ensure_ascii=False,
                                                                     separators=(",", ":")), encoding="utf-8")
                    sv["towers"][tid]["decks"] = fn
        sources = {"ranking": [{"fetch": k, "fetched": a.fetched, "n_towers": len(v["towers"])} for k, v in seasons.items()]}
        man = write_pack(a.out_dir, a.mode, [], written, {"seasons": seasons}, sources=sources, today=a.today)
        p = man["packs"][a.mode]
        print(f"idolroad: {len(seasons)} 个赛季、{p['entries']} 条人写 → {p['name']}（{p['bytes'] // 1024} KB）")
        return
    if not a.master:
        raise SystemExit("--master 必填（初 / N.I.A / H.I.F 要读初始牌组和偶像卡）")
    idols = idol_meta(a.master)
    decks = initial_decks(a.master)
    stats, summ = [], {}
    for f in sorted(a.records.glob("rec_*.json")):
        iid = f.stem.removeprefix("rec_")
        recs = json.loads(f.read_text(encoding="utf-8"))
        if not recs:
            continue
        meta = idols.get(iid)
        style = (meta or {}).get("style")
        initial = {p: d for (p, s), d in decks.items() if s == style}
        stats += stat_entries(a.mode, iid, recs, idol=meta, initial=initial, fetched=a.fetched)
        summ[iid] = summary(recs, idol=meta)
    try:
        import subprocess
        commit = subprocess.run(["git", "-C", str(a.entries), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip() or None
    except OSError:
        commit = None
    sources = {"entries_commit": commit, "ranking": [{"fetch": a.records.name, "fetched": a.fetched, "n_idols": len(summ)}]}
    man = write_pack(a.out_dir, a.mode, stats, written, summ, sources=sources, today=a.today)
    p = man["packs"][a.mode]
    print(f"{a.mode}: {len(summ)} 张偶像卡、{len(stats)} 条统计 + {p['entries'] - len(stats)} 条人写 → {p['name']}（{p['bytes'] // 1024} KB）")


if __name__ == "__main__":
    main()
