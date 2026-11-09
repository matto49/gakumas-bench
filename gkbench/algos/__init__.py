"""算法注册表。命令行写法：名字加可选参数，例如 ``pimc:worlds=16,seconds=1,mode=eval``。"""
from __future__ import annotations


def _registry():
    from .search import OracleAlgo, PimcAlgo
    from .simple import GreedyAlgo, RandomAlgo
    from .uinet import UinetAlgo
    return {"random": RandomAlgo, "greedy": GreedyAlgo, "uinet": UinetAlgo, "pimc": PimcAlgo, "oracle": OracleAlgo}


def _value(v):
    for cast in (int, float):
        try:
            return cast(v)
        except ValueError:
            pass
    return v


def make(spec: str):
    name, _, rest = spec.partition(":")
    params = {}
    for kv in filter(None, rest.split(",")):
        k, _, v = kv.partition("=")
        params[k.strip()] = _value(v.strip())
    reg = _registry()
    if name not in reg:
        raise SystemExit(f"未知算法 {name}，可选：{', '.join(reg)}")
    return reg[name](**params)


def names():
    return list(_registry())
