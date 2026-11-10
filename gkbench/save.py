"""审查存档 gkms.audition_save.v2（GKMS-STD-001 v2）的实现。

一个存档 = 一道题（编成 loadout、前缀 prefix、目标 objective、起点核对 check）+ 描述 meta + 若干张算法表 runs。
本模块只做格式本身：紧凑写法（第 2 章）、动作记号（第 3 章）、编号 / 题族编号 / 分享码 / 时间（第 4 章）、
算法表的打包展开（1.7）和读取核对（第 5 章）。和引擎打交道的部分（建局、重放）由调用方传入。

术语对照：题模板 = 编成不含 seed 的存档；固定种子题 = 编成含 seed 的存档；题族 = 同一开局（去掉 seed）的所有题。
"""
from __future__ import annotations

import base64
import hashlib
import json
import re
import zlib
from datetime import datetime, timezone

FORMAT = "gkms.audition_save.v2"
FORMATS = ("gkms.audition_save.v2", "gkms.audition_save.v1")   # v2 读取方要能读 v1
SHARE_PREFIX = "GKAS1:"
ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"                     # 不含 0 O 1 I L U
TOP = ("format", "id", "loadout", "prefix", "objective", "check", "meta", "runs")
HEADER = ("algo", "params", "budget", "seconds", "step_seconds", "rules", "machine", "mode", "by")   # 表 6（cols / rows 除外）
COLS = ("seed", "exam", "exam_sha", "score", "value", "err", "client", "secs", "step_ms", "at", "route")  # 表 7 的次序
MODES = ("internal", "self", "hosted", "player")
_ID = re.compile(r"^[A-Za-z0-9._-]+$")
_COUNT = re.compile(r"^(0|[1-9][0-9]*)$")


class SaveError(ValueError):
    """存档不合格（读取时应拒绝打开）。"""


# ---------------------------------------------------------------- 4.3 时间、4.1 规范化 JSON 与编号
def now_ts() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def canonical(obj) -> bytes:
    """4.1 b)：成员名按字典序，分隔符 , 和 :，无空白，非 ASCII 不转义，UTF-8。"""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _code8(obj) -> str:
    n = int(hashlib.sha256(canonical(obj)).hexdigest(), 16)
    out = []
    for _ in range(8):
        n, r = divmod(n, 30)
        out.append(ALPHABET[r])
    return "".join(out)


def archive_id(loadout: dict, prefix: str = "", objective: dict | None = None) -> str:
    """4.1：存档编号。loadout 是展开后的编成。"""
    return "AS-" + _code8({"loadout": loadout, "prefix": prefix, "objective": objective or {}})


def family_id(loadout: dict, objective: dict | None = None) -> str:
    """4.1（v2）：题族编号，去掉 seed、不含前缀。"""
    lo = {k: v for k, v in loadout.items() if k != "seed"}
    return "AF-" + _code8({"loadout": lo, "objective": objective or {}})


def seed_sha(seed) -> str:
    """表 7 exam_sha：十进制种子串的 SHA-256 前 12 位。"""
    return hashlib.sha256(str(int(seed)).encode("utf-8")).hexdigest()[:12]


# ---------------------------------------------------------------- 第 2 章 紧凑写法
def _is_count(v):
    return isinstance(v, int) and not isinstance(v, bool) and v >= 0


def _compact_card(c, field):
    idk, uk = ("produce_card_id", "current_upgrade_count") if field == "deck_cards" else ("id", "upgrade_count")
    if not isinstance(c, dict):
        return c
    keys = set(c)
    if not ({idk} <= keys <= {idk, uk, "customizes"}) or not isinstance(c.get(idk), str) or not _ID.match(c[idk]):
        return c
    if field == "deck_cards" and uk not in c:
        return c                                    # deck_cards 的强化次数应总是存在；缺了就保留对象
    s = c[idk]
    if uk in c:
        if not _is_count(c[uk]):
            return c
        if field == "produce_cards" or c[uk] != 0:
            s += f"+{c[uk]}"
    if "customizes" in c:
        cus = c["customizes"]
        if not isinstance(cus, list) or not cus:
            return c                                # 空 customizes 保留对象（2.3 d)）
        for x in cus:
            if not isinstance(x, dict) or set(x) != {"id", "customize_count"} or not isinstance(x["id"], str) \
                    or not _ID.match(x["id"]) or not _is_count(x["customize_count"]):
                return c                            # 成员不恰好是这两项、或计数不是非负整数：保留对象
            s += "/" + x["id"] + ("" if x["customize_count"] == 1 else f"*{x['customize_count']}")
    return s


def _expand_card(s, field):
    if not isinstance(s, str):
        return s
    idk, uk = ("produce_card_id", "current_upgrade_count") if field == "deck_cards" else ("id", "upgrade_count")
    head, *cus = s.split("/")
    cid, plus, n = head.partition("+")
    if not _ID.match(cid) or (plus and not _COUNT.match(n)):
        raise SaveError(f"卡牌紧凑写法不合法：{s}")
    out = {idk: cid}
    if plus:
        out[uk] = int(n)
    elif field == "deck_cards":
        out[uk] = 0
    if cus:
        out["customizes"] = []
        for cu in cus:
            k, star, m = cu.partition("*")
            if not _ID.match(k) or (star and not _COUNT.match(m)):
                raise SaveError(f"定制紧凑写法不合法：{s}")
            out["customizes"].append({"id": k, "customize_count": int(m) if star else 1})
    return out


def _compact_support(x):
    if isinstance(x, dict) and set(x) == {"support_card_id", "permil"} and isinstance(x["support_card_id"], str) \
            and _ID.match(x["support_card_id"]) and _is_count(x["permil"]):
        return f"{x['support_card_id']}:{x['permil']}"
    return x


def _expand_support(x):
    if not isinstance(x, str):
        return x
    sid, _, p = x.rpartition(":")
    if not _ID.match(sid) or not _COUNT.match(p):
        raise SaveError(f"支援卡紧凑写法不合法：{x}")
    return {"support_card_id": sid, "permil": int(p)}


def compact_loadout(lo: dict) -> dict:
    """展开 → 紧凑。写出前验证能无损展开回来（2.1）。"""
    out = dict(lo)
    for f in ("deck_cards", "produce_cards"):
        if isinstance(out.get(f), list):
            out[f] = [_compact_card(c, f) for c in out[f]]
    if isinstance(out.get("support_cards"), list):
        out["support_cards"] = [_compact_support(x) for x in out["support_cards"]]
    for k in ("parameters", "score_bonus_permils"):
        v = out.get(k)
        if isinstance(v, dict) and set(v) == {"1", "2", "3"}:
            out[k] = [v["1"], v["2"], v["3"]]
    if expand_loadout(out) != lo:
        raise SaveError("紧凑写法不能无损展开（生成方自检失败）")
    return out


def expand_loadout(lo: dict) -> dict:
    out = dict(lo)
    for f in ("deck_cards", "produce_cards"):
        if isinstance(out.get(f), list):
            out[f] = [_expand_card(c, f) for c in out[f]]
    if isinstance(out.get("support_cards"), list):
        out["support_cards"] = [_expand_support(x) for x in out["support_cards"]]
    for k in ("parameters", "score_bonus_permils"):
        v = out.get(k)
        if isinstance(v, list):
            if len(v) != 3:
                raise SaveError(f"{k} 的三元组长度不是 3")
            out[k] = {"1": v[0], "2": v[1], "3": v[2]}
    return out


# ---------------------------------------------------------------- 第 3 章 动作记号
_TOKEN = re.compile(r"^(?:p(0|[1-9][0-9]*)|d(0|[1-9][0-9]*)|e|s((?:0|[1-9][0-9]*)(?:,(?:0|[1-9][0-9]*))*))$")


def token_of(action) -> str:
    kind = action[0]
    if kind == "play":
        return f"p{int(action[1])}"
    if kind == "drink":
        return f"d{int(action[1])}"
    if kind == "end":
        return "e"
    if kind == "select":
        idx = action[1] if isinstance(action[1], (list, tuple)) else action[1:]
        return "s" + ",".join(str(int(i)) for i in idx)
    raise SaveError(f"没有记号的动作：{action}")


def action_of(token: str):
    m = _TOKEN.match(token)
    if not m:
        raise SaveError(f"不合法的记号：{token!r}")
    if m.group(1) is not None:
        return ("play", int(m.group(1)))
    if m.group(2) is not None:
        return ("drink", int(m.group(2)))
    if token == "e":
        return ("end",)
    return ("select", [int(x) for x in m.group(3).split(",")])


def route_of(actions) -> str:
    return " ".join(token_of(a) for a in actions)


def parse_route(route: str):
    if route == "":
        return []
    if route != route.strip() or "  " in route:
        raise SaveError("路线首尾不应有空格，记号之间只用一个空格")
    return [action_of(t) for t in route.split(" ")]


# ---------------------------------------------------------------- 1.7 算法表
def default_mode(algo: str) -> str:
    """1.7 h)：mode 省略时的取值。"""
    if algo == "player":
        return "player"
    if algo.startswith("external:"):
        return "self"
    return "internal"


def pack_runs(answers: list[dict]) -> list[dict]:
    """一条条答（表头成员 + 列）→ 算法表。表头相同的答合成一张表；cols 只列出用到的列，按表 7 次序。"""
    tables: dict[str, dict] = {}
    for a in answers:
        head = {k: a[k] for k in HEADER if a.get(k) is not None}
        if "algo" not in head or "rules" not in head:
            raise SaveError("答缺 algo 或 rules")
        if "budget" in head and "seconds" in head:
            raise SaveError("budget 和 seconds 不应同时出现")
        key = canonical(head).decode()
        t = tables.setdefault(key, {"head": head, "rows": []})
        t["rows"].append({k: a[k] for k in COLS if a.get(k) is not None})
    out = []
    for t in tables.values():
        cols = [c for c in COLS if any(c in r for r in t["rows"])]
        if "route" not in cols or "score" not in cols or "at" not in cols:
            raise SaveError("每条答都要有 score、at、route")
        out.append(dict(t["head"], cols=cols, rows=[[r.get(c) for c in cols] for r in t["rows"]]))
    return out


def unpack_runs(runs: list[dict]) -> list[dict]:
    """算法表 → 一条条答（5 b)）。null 等于没有该成员。"""
    answers, seen = [], set()
    for t in runs or []:
        if not isinstance(t, dict):
            raise SaveError("算法表应是对象")
        head = {k: t[k] for k in HEADER if k in t}
        extra = set(t) - set(HEADER) - {"cols", "rows"}
        if extra:
            raise SaveError(f"算法表有未定义的成员：{sorted(extra)}")
        for need in ("algo", "rules", "cols", "rows"):
            if need not in t:
                raise SaveError(f"算法表缺 {need}")
        if "budget" in head and "seconds" in head:
            raise SaveError("budget 和 seconds 不应同时出现（1.7 b)）")
        if head.get("mode") is not None and head["mode"] not in MODES:
            raise SaveError(f"mode 取值不对：{head['mode']}")
        key = canonical(head).decode()
        if key in seen:
            raise SaveError("有两张表头完全相同的表（1.7 a)）")
        seen.add(key)
        cols = t["cols"]
        if any(c not in COLS for c in cols) or [c for c in COLS if c in cols] != list(cols) or cols[-1] != "route":
            raise SaveError("cols 只应列出表 7 中的列，按表 7 的次序，route 在最后（1.7 c)）")
        for row in t["rows"]:
            if len(row) != len(cols):
                raise SaveError("答的格数不等于 cols 的长度")
            ans = dict(head)
            ans.update({c: v for c, v in zip(cols, row) if v is not None})
            ans.setdefault("mode", default_mode(ans["algo"]))
            for need in ("score", "at", "route"):
                if need not in ans:
                    raise SaveError(f"答缺 {need}")
            answers.append(ans)
    return answers


# ---------------------------------------------------------------- 存档的生成
def make_archive(loadout: dict, *, prefix: str = "", objective: dict | None = None, check: dict | None = None,
                 meta: dict | None = None, answers: list[dict] | None = None) -> dict:
    """loadout 为展开后的编成：含 seed 是固定种子题，不含是题模板（1.8）。"""
    objective = objective or {}
    template = "seed" not in loadout
    if template:
        if prefix:
            raise SaveError("题模板的前缀应为空串（1.8 a)）")
        check = {}
    elif not check:
        raise SaveError("固定种子题要有 check（1.5）")
    meta = dict(meta or {})
    meta["family"] = family_id(loadout, objective)
    meta.setdefault("created", now_ts())
    if "source" not in meta:
        raise SaveError("meta.source 必备（表 4）")
    return {"format": FORMAT, "id": archive_id(loadout, prefix, objective), "loadout": compact_loadout(loadout),
            "prefix": prefix, "objective": objective, "check": check, "meta": meta,
            "runs": pack_runs(answers or [])}


def is_template(doc: dict) -> bool:
    lo = doc.get("loadout") or {}
    return "seed" not in lo


# ---------------------------------------------------------------- 4.2 分享码
def share_code(doc: dict) -> str:
    part = {k: doc[k] for k in ("format", "loadout", "prefix", "objective", "check", "meta")}
    raw = zlib.compress(canonical(part), 9)
    return SHARE_PREFIX + base64.urlsafe_b64encode(raw).decode().rstrip("=")


def from_share_code(code: str) -> dict:
    if not code.startswith(SHARE_PREFIX):
        raise SaveError(f"分享码应以 {SHARE_PREFIX} 开头")
    body = code[len(SHARE_PREFIX):].strip()
    raw = zlib.decompress(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    doc = json.loads(raw.decode("utf-8"))
    doc["runs"] = []
    doc["id"] = archive_id(expand_loadout(doc["loadout"]), doc.get("prefix", ""), doc.get("objective") or {})
    return doc


# ---------------------------------------------------------------- 第 5 章 读取与核对
def read(doc: dict, *, engine_check=None) -> dict:
    """按第 5 章读取。返回 {"doc", "loadout"（展开）, "answers", "template", "id", "family"}；不合格抛 SaveError。

    engine_check(loadout, prefix_actions) -> dict(turn, score, stamina, hand, rules) 由调用方给出（建局、执行前缀、
    返回到达的局面）；不给时跳过 d) e)（只做格式和编号核对）。"""
    if not isinstance(doc, dict):
        raise SaveError("存档应是 JSON 对象")
    if doc.get("format") not in FORMATS:                                       # a)
        raise SaveError(f"format 不是 {FORMATS}")
    missing = [k for k in TOP if k not in doc]
    extra = [k for k in doc if k not in TOP]
    if missing or extra:
        raise SaveError(f"顶层成员不对：缺 {missing}，多 {extra}")
    lo = expand_loadout(doc["loadout"])                                        # b)
    answers = unpack_runs(doc["runs"])
    prefix, objective = doc["prefix"], doc["objective"]
    if not isinstance(prefix, str) or not isinstance(objective, dict):
        raise SaveError("prefix 应是字符串、objective 应是对象")
    want = archive_id(lo, prefix, objective)                                  # c)
    if want != doc["id"]:
        raise SaveError(f"编号不符：文件写 {doc['id']}，按内容算是 {want}（题被改动过）")
    fam = family_id(lo, objective)
    meta = doc.get("meta") or {}
    if meta.get("family") is not None and meta["family"] != fam:              # f)
        raise SaveError(f"题族编号不符：文件写 {meta['family']}，按内容算是 {fam}")
    template = "seed" not in lo
    actions = parse_route(prefix)
    if template:
        if prefix != "" or doc["check"] != {}:
            raise SaveError("题模板的 prefix 应为空串、check 应为空对象（1.8）")
        for a in answers:
            if a.get("exam") is None and a.get("exam_sha") is None:
                raise SaveError("题模板的答应有 exam 或 exam_sha（1.7 g)）")
    else:
        for a in answers:
            if a.get("exam") is not None or a.get("exam_sha") is not None:
                raise SaveError("固定种子题的答不应写 exam / exam_sha（1.7 g)）")
        chk = doc["check"]
        for k in ("turn", "score", "stamina", "hand", "rules", "commit"):
            if k not in chk:
                raise SaveError(f"check 缺 {k}")
        if engine_check is not None:                                           # d) e)
            got = engine_check(lo, actions)
            diff = {k: (chk[k], got[k]) for k in ("turn", "score", "stamina", "hand") if chk[k] != got[k]}
            if diff:
                raise SaveError(f"起点核对不符（存档 / 本引擎）：{diff}；本引擎规则 {got.get('rules')}，存档 {chk['rules']}")
    return {"doc": doc, "loadout": lo, "answers": answers, "template": template, "id": doc["id"], "family": fam}


def dumps(doc: dict) -> str:
    """写成文件，排版照附录 B：顶层和编成的成员各占一行，牌组一张牌一行，每条答单独一行（4.4）。"""
    j = lambda v: json.dumps(v, ensure_ascii=False)
    out = ["{"]
    for k in TOP:
        v = doc[k]
        if k == "loadout":
            out.append(' "loadout": {')
            items = list(v.items())
            for i, (lk, lv) in enumerate(items):
                tail = "," if i < len(items) - 1 else ""
                if isinstance(lv, list) and lv and lk in ("deck_cards", "produce_cards", "support_cards"):
                    out.append(f"  {j(lk)}: [")
                    out += [f"    {j(x)}" + ("," if n < len(lv) - 1 else "") for n, x in enumerate(lv)]
                    out.append("  ]" + tail)
                else:
                    out.append(f"  {j(lk)}: {j(lv)}{tail}")
            out.append(" },")
        elif k == "meta":
            out.append(' "meta": {')
            items = list(v.items())
            out += [f"  {j(mk)}: {j(mv)}" + ("," if i < len(items) - 1 else "") for i, (mk, mv) in enumerate(items)]
            out.append(" },")
        elif k == "runs":
            if not v:
                out.append(' "runs": []')
                continue
            out.append(' "runs": [')
            for ti, t in enumerate(v):
                out.append("   {")
                for hk in [x for x in t if x != "rows"]:
                    out.append(f"    {j(hk)}: {j(t[hk])},")
                out.append('    "rows": [')
                out += [f"      {j(r)}" + ("," if n < len(t["rows"]) - 1 else "") for n, r in enumerate(t["rows"])]
                out.append("    ]")
                out.append("   }" + ("," if ti < len(v) - 1 else ""))
            out.append(" ]")
        else:
            out.append(f" {j(k)}: {j(v)},")
    out.append("}")
    return "\n".join(out) + "\n"
