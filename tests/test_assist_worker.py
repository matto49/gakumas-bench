"""引擎子进程的助手操作：assist_open / assist_hand / assist_step / assist_undo / assist_numbers / assist_close。
起一个真的 gkbench.worker 子进程，按行收发 JSON。"""
import glob
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from gkbench import engine

PROBLEMS = sorted(glob.glob(str(Path.home() / "github/gakumas-bench-data/problems/hif/*.gksave.json")))
pytestmark = pytest.mark.skipif(not PROBLEMS or not (engine.GKMS_ROOT / "GakumasCLI").is_dir(), reason="缺 GKMS 或 H.I.F 题")
ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def worker():
    p = subprocess.Popen([sys.executable, "-m", "gkbench.worker"], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.DEVNULL, text=True, env=dict(os.environ, PYTHONPATH=str(ROOT)))
    n = [0]

    def call(**req):
        n[0] += 1
        p.stdin.write(json.dumps(dict(req, rid=n[0]), ensure_ascii=False) + "\n")
        p.stdin.flush()
        rep = json.loads(p.stdout.readline())
        assert rep["rid"] == n[0]
        return rep

    yield call
    p.stdin.close()
    p.wait(timeout=10)


def lo():
    return json.load(open(PROBLEMS[0]))["loadout"]


def test_open_hand_step_undo_close(worker):
    r = worker(op="assist_open", sid="a1", loadout=lo(), practice=False)
    assert r["ok"] and r["view"]["awaiting_hand"] is True
    hand = r["view"]["piles"]["hand"]
    r = worker(op="assist_hand", sid="a1", cards=hand)
    assert r["ok"] and r["view"]["advice"] is not None
    act = r["view"]["obs"]["legal"][r["view"]["advice"]["best"]]
    r = worker(op="assist_step", sid="a1", action=act)
    assert r["ok"] and r["view"]["can_undo"]
    r = worker(op="assist_undo", sid="a1")
    assert r["ok"]
    r = worker(op="assist_numbers", sid="a1", score=100, stamina=3, block=4)
    assert r["ok"] and r["view"]["score"] == 100
    assert worker(op="assist_close", sid="a1")["ok"]
    r = worker(op="assist_step", sid="a1", action=["end"])
    assert not r["ok"] and r["error"] == "这局已经结束或不存在"


def test_open_from_code(worker):
    from gkbench.assist_code import pack_ga1
    r = worker(op="assist_open", sid="a2", code=pack_ga1("x", lo()), practice=True)
    assert r["ok"] and r["view"]["practice"] is True and r["view"]["advice"] is not None
    worker(op="assist_close", sid="a2")


def test_visitor_errors_are_short(worker):
    r = worker(op="assist_open", sid="a3", loadout=dict(lo(), deck_cards=[lo()["deck_cards"][0]] * 61))
    assert not r["ok"] and "卡组" in r["error"] and "trace" not in r
    r = worker(op="assist_open", sid="a4", code="GA1!!!")
    assert not r["ok"] and r["error"].startswith("码") and "trace" not in r
    r = worker(op="assist_open", sid="a5", loadout={"schema": "nonsense"})
    assert not r["ok"] and "trace" not in r and len(r["error"]) < 200


def test_illegal_step_rejected(worker):
    worker(op="assist_open", sid="a6", loadout=lo(), practice=True)
    r = worker(op="assist_step", sid="a6", action=["play", 99])
    assert not r["ok"] and "不能这样出" in r["error"]
    worker(op="assist_close", sid="a6")
