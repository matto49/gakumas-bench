"""托管评测不强依赖 GKMS：外部算法按「文件.py:类名」加载；needs_gkms=False 的算法跑托管时不加载 GKMS。"""
from pathlib import Path

import pytest

from gkbench import algos, client, engine

EXAMPLE = Path(__file__).resolve().parents[1] / "examples" / "first_playable.py"


def test_external_file_algo_with_params():
    a = algos.make(f"{EXAMPLE}:FirstPlayable:foo=2,bar=x")
    assert a.name == "first-playable" and a.params == {"foo": 2, "bar": "x"}
    assert a.needs_gkms is False


def test_external_errors_are_clear():
    with pytest.raises(SystemExit, match="找不到算法文件"):
        algos.make("nope/missing.py:X")
    with pytest.raises(SystemExit, match="没有 Nope"):
        algos.make(f"{EXAMPLE}:Nope")


def test_builtin_needs_gkms_flags():
    from gkbench.algos.search import OracleAlgo, PimcAlgo
    from gkbench.algos.simple import GreedyAlgo, RandomAlgo
    from gkbench.algos.uinet import UinetAlgo
    assert not RandomAlgo.needs_gkms
    assert GreedyAlgo.needs_gkms and PimcAlgo.needs_gkms and OracleAlgo.needs_gkms and UinetAlgo.needs_gkms


class _Resp:
    def __init__(self, data, status=200):
        self._d, self.status_code, self.text = data, status, ""

    def json(self):
        return self._d

    def raise_for_status(self):
        return self


class _FakeServer:
    """一题一个种子，两步打完。"""

    def __init__(self):
        self.steps = []

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def get(self, path):
        assert path == "/api/sets/demo/problems"
        return _Resp([{"id": "P1", "name": "demo-1", "seeds": [{"index": 0}]}])

    def post(self, path, json=None):
        obs = {"legal": [["play", 0], ["end"]], "hand": [{"id": "x"}]}
        if path == "/api/episodes":
            return _Resp({"episode": "E1", "obs": obs, "meta": {}, "loadout": {}})
        if path == "/api/episodes/E1/step":
            self.steps.append(json["action"])
            done = len(self.steps) >= 2
            return _Resp({"done": done, "obs": obs, "final": {"score": 123, "decisions": 2, "secs": 0.1}})
        raise AssertionError(path)

    def delete(self, path):
        pass


def test_hosted_does_not_load_gkms(monkeypatch):
    def boom():
        raise AssertionError("不该加载 GKMS")

    monkeypatch.setattr(engine, "setup", boom)
    srv = _FakeServer()
    monkeypatch.setattr(client, "_client", lambda server=None: srv)
    out = []
    client.hosted("demo", algos.make(f"{EXAMPLE}:FirstPlayable"), progress=out.append)
    assert srv.steps == [["play", 0], ["play", 0]] and "123" in out[0]
