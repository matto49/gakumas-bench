"""出牌助手的码。

GA1：我们自己的编成码。``GA1`` + base64url(raw deflate(JSON {"v": 1, "mode", "name", "loadout"}))，去掉末尾的 ``=``。
GR1：GKMS 客户端「导出 GKMSUINet」给的对局码（GKMS GakumasCLI/corpus/uinet_export.py 的格式，和 GKMSUINetWeb 通用）：
     ``GR1`` + 同样的编码，JSON {"n": 名字, "d": 带真种子的开局配置, "x": 已经打过的动作}。

parse_code 两种都认，也认 GKMS 给的 ``https://gkmstest.nyarot.org/#c=<码>`` 链接。返回的 loadout 一律不带种子；
GR1 的种子单独放在 ``seed`` 里，只用来把局面重放到玩家现在的位置（见 assist.AssistSession.from_code）。
"""
from __future__ import annotations

import base64
import binascii
import json
import zlib

MAX_RAW = 256 * 1024            # 解压后最多 256 KB：编成再大也就几 KB，防有人塞超大的码
MAX_CODE = 64 * 1024            # 码本身的长度上限


class CodeError(ValueError):
    pass


def _encode(obj) -> str:
    raw = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    c = zlib.compressobj(9, zlib.DEFLATED, -15)
    return base64.urlsafe_b64encode(c.compress(raw) + c.flush()).decode("ascii").rstrip("=")


def _decode(body: str):
    try:
        data = base64.urlsafe_b64decode(body + "=" * (-len(body) % 4))
        d = zlib.decompressobj(-15)
        raw = d.decompress(data, MAX_RAW + 1)
    except (binascii.Error, ValueError, zlib.error) as e:
        raise CodeError(f"码读不出来：{e}") from None
    if len(raw) > MAX_RAW or d.unconsumed_tail:
        raise CodeError("码太大了")
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise CodeError("码里不是编成数据") from None


def pack_ga1(name: str, loadout: dict, mode: str = "hif") -> str:
    lo = {k: v for k, v in loadout.items() if k != "seed"}
    return "GA1" + _encode({"v": 1, "mode": mode, "name": name, "loadout": lo})


def parse_code(code: str) -> dict:
    """{"kind": "GA" | "GR", "name", "mode", "loadout"（不带种子）, "seed"（GR1 才有）, "plays"}"""
    code = (code or "").strip()
    if "#c=" in code:                              # GKMS 给的链接
        code = code.split("#c=", 1)[1].strip()
    if len(code) > MAX_CODE:
        raise CodeError("码太长了")
    if len(code) < 4 or code[2] != "1" or code[:2] not in ("GA", "GR"):
        raise CodeError("这不是编成码（GA1）或 GKMS 导出的对局码（GR1）")
    kind, obj = code[:2], _decode(code[3:])
    if not isinstance(obj, dict):
        raise CodeError("码里不是编成数据")
    if kind == "GA":
        lo, name, plays, seed, mode = obj.get("loadout"), obj.get("name"), [], None, obj.get("mode") or "hif"
    else:
        lo, name, plays, mode = obj.get("d"), obj.get("n"), obj.get("x") or [], "hif"
        seed = lo.get("seed") if isinstance(lo, dict) else None
    if not isinstance(lo, dict):
        raise CodeError("码里没有编成")
    if not isinstance(plays, list):
        raise CodeError("码里的出牌记录不对")
    if seed is not None:
        try:
            seed = int(seed)
        except (TypeError, ValueError):
            raise CodeError("码里的种子不对") from None
    return {"kind": kind, "name": str(name or ""), "mode": str(mode), "loadout": {k: v for k, v in lo.items() if k != "seed"},
            "seed": seed, "plays": plays}
