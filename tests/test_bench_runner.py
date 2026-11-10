"""评测机：提交格式检查、改了文件要重跑、算法在沙盒子进程里读不到用户目录。"""
import json
import random
import shutil
from pathlib import Path

import pytest

from gkbench import bench_runner as BR

EXAMPLE = Path(__file__).resolve().parents[1] / "submissions" / "_example"


def _sub(root, name, **cfg):
    d = root / name
    d.mkdir()
    shutil.copy(EXAMPLE / "algo.py", d / "algo.py")
    base = {"label": name, "entry": "algo.py:FirstPlayable", "author": "someone"}
    (d / "submission.json").write_text(json.dumps({**base, **cfg}))
    return d


def test_load_submissions_validates(tmp_path):
    _sub(tmp_path, "good-one", sets=["hif-live", "gkms480"], step_seconds=2)
    _sub(tmp_path, "bad-label", label="Bad Label")
    _sub(tmp_path, "bad-entry", entry="../x.py:Y")
    _sub(tmp_path, "too-slow", step_seconds=30)
    _sub(tmp_path, "zz-dup", label="good-one")
    _sub(tmp_path, "_template")
    subs = {s["name"]: s for s in BR.load_submissions(tmp_path)}
    assert "_template" not in subs
    assert "error" not in subs["good-one"] and subs["good-one"]["sets"] == ["hif-live", "gkms480"]
    for bad in ("bad-label", "bad-entry", "too-slow", "zz-dup"):
        assert "error" in subs[bad], bad


def test_job_key_changes_with_content(tmp_path):
    d = _sub(tmp_path, "algo-x")
    sub = BR.load_submissions(tmp_path)[0]
    k1 = BR.job_key(sub, "hif-live", 55)
    (d / "algo.py").write_text((d / "algo.py").read_text() + "\n# changed\n")
    assert BR.job_key(sub, "hif-live", 55) != k1
    assert BR.job_key(sub, "gkms480", 55) != BR.job_key(sub, "hif-live", 55)


class _Ctx:
    def __init__(self, obs):
        self.obs, self.budget, self.loadout, self.meta, self.rng = obs, 1.0, {}, {}, random.Random(1)

    def worlds(self, k):
        raise AssertionError("不该要世界")


@pytest.mark.skipif(shutil.which("sandbox-exec") is None, reason="只有 macOS 有 sandbox-exec")
def test_sandboxed_algo_cannot_read_home(tmp_path):
    from gkbench.sandbox import SandboxedAlgo
    secret = Path.home() / ".gkbench-sandbox-test-secret"
    secret.write_text("s3cret")
    algo_file = tmp_path / "peek.py"
    algo_file.write_text(f'''
from pathlib import Path
from gkbench.algos.base import Algorithm, Decision
class Peek(Algorithm):
    name = "peek"
    def decide(self, ctx):
        try:
            got = Path({str(secret)!r}).read_text()
        except Exception as e:
            got = type(e).__name__
        return Decision(("end",), {{"got": got}})
''')
    try:
        a = SandboxedAlgo(f"{algo_file}:Peek")
        ctx = _Ctx({"legal": [["end"]]})
        a.begin(ctx)
        d = a.decide(ctx)
        a.close()
    finally:
        secret.unlink()
    assert d.action == ("end",) and d.meta["got"] == "PermissionError"
