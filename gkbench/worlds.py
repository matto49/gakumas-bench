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
    cfg = w.config
    fake = rng.randrange(1, 2 ** 31 - 1)
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
