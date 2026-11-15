"""Rewrite a label file with the observations the current UIObs code builds, by replaying every episode.

    python -B -m uinet.reobserve IN.jsonl.zst OUT.jsonl.zst [--workers W]

For labels written by an earlier payload (SX-04-02 ran d935b9f, before the timed gains got their own status kinds).
An episode whose replay differs from the stored observations in anything but the status kinds (the engine changed
the battle) is dropped and counted.  OUT has the same format as uinet.gen writes, so uinet.train reads it unchanged.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from multiprocessing import Pool
from pathlib import Path

from . import engine


def _init():
    engine.setup()


def _one(line):
    from .gen import reobserved
    ep = json.loads(line)
    decisions = reobserved(ep)
    if decisions is None:
        return None, ep["idx"]
    return json.dumps(dict(ep, decisions=decisions), separators=(",", ":")), ep["idx"]


def _lines(path):
    from .gen import read_episodes
    for ep in read_episodes(path):
        yield json.dumps(ep, separators=(",", ":"))


def main(argv=None):
    p = argparse.ArgumentParser(prog="uinet.reobserve")
    p.add_argument("src")
    p.add_argument("dst")
    p.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    a = p.parse_args(argv)
    import zstandard
    src, dst = Path(a.src).resolve(), Path(a.dst).resolve()
    dst.parent.mkdir(parents=True, exist_ok=True)
    cctx = zstandard.ZstdCompressor(level=10)
    t0, n, dec, dropped = time.time(), 0, 0, []
    with Pool(a.workers, initializer=_init) as pool, open(dst, "wb") as fh:
        for line, idx in pool.imap(_one, _lines(src), chunksize=4):
            n += 1
            if line is None:
                dropped.append(idx)
                continue
            dec += line.count('"obs":')
            fh.write(cctx.compress((line + "\n").encode("utf-8")))
    print(f"{dst.name}: {n} episodes read, {n - len(dropped)} written ({dec} decisions), {len(dropped)} dropped "
          f"{sorted(dropped)[:20]}; {time.time() - t0:.0f} s", flush=True)


if __name__ == "__main__":
    sys.exit(main())
