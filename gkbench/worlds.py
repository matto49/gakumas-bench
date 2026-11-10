"""世界采样：给「多世界平均」类算法（PIMC 等）造出和公开信息一致、但隐藏信息随机的局面。

隐藏信息只有三样：山札顺序、随机数状态、种子。其余都是画面上看得到的，原样复制。
tests/test_worlds.py 检查采出来的世界不带真实的山札顺序和随机数，公开观测和真局面一致。
"""
from __future__ import annotations

import dataclasses
import random


def sample_world(session, rng: random.Random):
    w = session.clone()

    def reshuffle(view):
        rng.shuffle(view.deck.deck)

    w.edit(reshuffle)
    w.deck.rng.state = rng.getrandbits(32) or 1
    _scrub_seed(w, rng)
    return w


def _scrub_seed(w, rng):
    """会话里记着种子的地方有三处：config.seed、_seed、_loadout["seed"]（native_dump 导出时会带上后两处）。
    全换成假种子；_loadout 的回合属性写成开考就公开的那份，客户端按它重建同一局再导入状态。"""
    cfg = w.config
    fake = rng.randrange(1, 2 ** 31 - 1)
    if getattr(w, "_seed", None) is not None:
        w._seed = fake
    lo = getattr(w, "_loadout", None)
    if isinstance(lo, dict):
        types = list(getattr(w.deck, "turn_parameter_types", None) or lo.get("turn_parameter_types") or ())
        tpt = {i + 1: int(t) for i, t in enumerate(types)}   # GKMS 要 {回合: 属性}
        w._loadout = dict(lo, seed=fake, **({"turn_parameter_types": tpt} if tpt else {}))
    try:
        if dataclasses.is_dataclass(cfg):
            w.config = dataclasses.replace(cfg, seed=fake)
        else:
            cfg = type(cfg).__new__(type(cfg))
            cfg.__dict__.update(w.config.__dict__)
            cfg.seed = fake
            w.config = cfg
    except Exception:
        pass


def export_world(world) -> bytes:
    """把一个已经重抽过隐藏信息的世界导出成字节（zlib 压缩，约 3 KB），给托管模式下的客户端用。

    GKMS 原生核心的状态头里还存着 round_seed（只用来给卡牌起内部编号），这里换成 _loadout 里的假种子，
    客户端按假种子重建这一局再导入状态，前后一致。tests/test_worlds.py 检查导出数据里找不到真种子。"""
    import zlib
    from GakumasCLI.native.native_session import native_dump
    fake = int(world._loadout["seed"])
    st = bytes(world._export())
    head = st[:16]
    blob = native_dump(world)
    if blob.count(head) != 1:
        raise RuntimeError("导出数据里找不到唯一的状态头，GKMS 格式可能变了")
    blob = blob.replace(head, head[:8] + fake.to_bytes(8, "little", signed=True))
    return zlib.compress(blob, 6)


def import_world(data: bytes):
    """export_world 的逆过程：在本进程按公开开局配置重建这一局，导入状态。"""
    import zlib
    from GakumasCLI.native.native_session import native_load
    from . import engine
    return native_load(zlib.decompress(data), engine.master())
