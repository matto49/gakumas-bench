"""算法注册表。命令行写法：名字加可选参数，例如 ``pimc:worlds=16,seconds=1,mode=eval``。

自己的算法（不用改本仓库）：
  my_algo.py:MyAlgo                 一个 .py 文件里的类（相对当前目录或绝对路径）
  my_algo.py:MyAlgo:depth=2,k=8     带参数
  mypkg.algo:MyAlgo                 已安装 / 在 PYTHONPATH 里的模块
类继承 gkbench.algos.base.Algorithm（或至少有 name、decide(ctx)、describe()），见 examples/first_playable.py。
"""
from __future__ import annotations


def _registry():
    from .search import OracleAlgo, PimcAlgo
    from .simple import GreedyAlgo, RandomAlgo
    from .uinet import UinetAlgo
    from .official_ai import OfficialAIAlgo
    from .hiro import HiroRulesAlgo
    return {"random": RandomAlgo, "greedy": GreedyAlgo, "uinet": UinetAlgo, "pimc": PimcAlgo, "oracle": OracleAlgo, "official-ai": OfficialAIAlgo, "hiro-rules": HiroRulesAlgo}


def _value(v):
    for cast in (int, float):
        try:
            return cast(v)
        except ValueError:
            pass
    return v


def _params(rest: str) -> dict:
    params = {}
    for kv in filter(None, rest.split(",")):
        k, _, v = kv.partition("=")
        params[k.strip()] = _value(v.strip())
    return params


def _external(spec: str):
    """「文件.py:类名[:参数]」或「包.模块:类名[:参数]」→ (类, 参数)；不是外部写法返回 None。"""
    import importlib
    import importlib.util
    import sys
    from pathlib import Path

    target, _, rest = spec.partition(":")
    if not (target.endswith(".py") or "/" in target or "\\" in target or "." in target):
        return None
    cls_name, _, prm = rest.partition(":")
    if not cls_name:
        raise SystemExit(f"外部算法要写成 文件.py:类名 或 包.模块:类名，收到 {spec}")
    if target.endswith(".py"):
        path = Path(target).expanduser().resolve()
        if not path.is_file():
            raise SystemExit(f"找不到算法文件 {path}")
        mod_name = f"gkbench_user_{path.stem}"
        mod = sys.modules.get(mod_name)
        if mod is None:
            if str(path.parent) not in sys.path:      # 同目录的辅助模块也能 import
                sys.path.insert(0, str(path.parent))
            sp = importlib.util.spec_from_file_location(mod_name, path)
            mod = importlib.util.module_from_spec(sp)
            sys.modules[mod_name] = mod
            sp.loader.exec_module(mod)
    else:
        mod = importlib.import_module(target)
    cls = getattr(mod, cls_name, None)
    if cls is None:
        raise SystemExit(f"{target} 里没有 {cls_name}")
    return cls, _params(prm)


def make(spec: str):
    ext = _external(spec)
    if ext is not None:
        cls, params = ext
        return cls(**params)
    name, _, rest = spec.partition(":")
    params = _params(rest)
    reg = _registry()
    if name not in reg:
        raise SystemExit(f"未知算法 {name}，可选：{', '.join(reg)}；自己的算法写 文件.py:类名")
    return reg[name](**params)


def names():
    return list(_registry())
