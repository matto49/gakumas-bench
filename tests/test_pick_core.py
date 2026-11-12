"""核心题单挑法的几条保证（gkbench/pick_core.py）。"""
import collections
import random

from gkbench.pick_core import pick


def make_info():
    rng = random.Random(0)
    info = {}
    for i in range(300):
        idol = f"idol{rng.randrange(20)}"
        info[f"P{i}"] = {"idol": idol, "mechanic": f"m{hash(idol) % 4}", "stage": f"s{rng.randrange(5)}",
                         "source": "live" if i < 10 else "capture"}
    return info


def test_pick_guarantees():
    info = make_info()
    ch = set(pick(info, 60, random.Random(1)))
    assert len(ch) == 60
    assert {i for i in info if info[i]["source"] == "live"} <= ch
    assert {info[i]["idol"] for i in ch} == {x["idol"] for x in info.values()}
    cells = collections.defaultdict(set)
    for i, x in info.items():
        cells[(x["mechanic"], x["stage"])].add(i)
    for pool in cells.values():
        assert len(pool & ch) >= min(2, len(pool))
