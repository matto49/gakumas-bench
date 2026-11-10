"""沙盒里的算法进程：只跑一个算法，经 stdin / stdout 和裁判进程（gkbench.sandbox.SandboxedAlgo）按行交换 JSON。

    python -m gkbench.algo_host <算法写法>          # 同 --algo：内置名字、文件.py:类名、包.模块:类名

它看不到种子、真实局面和保密种子文件（裁判在另一个进程里，沙盒也挡着读），每一步只拿到公开观测。
协议（每行一个 JSON）：
  裁判 → 算法  {"op": "describe"}
               {"op": "begin", "obs", "budget", "loadout", "meta", "rng"}     rng：这一局算法专用随机数的种子
               {"op": "decide", "obs"}
               {"op": "worlds", "worlds": [base64…]}                         回应算法的「要世界」
               {"op": "quit"}
  算法 → 裁判  {"op": "describe", "desc", "about", "needs_gkms", "privileged"}
               {"op": "worlds", "k"}                                         decide / begin 里调 ctx.worlds(k)
               {"op": "ok"} / {"op": "decision", "action", "meta"} / {"op": "error", "error"}
算法自己 print 的内容改到 stderr，不会混进协议。
"""
from __future__ import annotations

import base64
import json
import os
import random
import sys
import traceback


class HostCtx:
    def __init__(self, chan, msg):
        self._chan = chan
        self.obs, self.budget = msg.get("obs"), msg.get("budget")
        self.loadout, self.meta = msg.get("loadout"), msg.get("meta")
        self.rng = random.Random(msg.get("rng"))
        self.worlds_made = 0

    def worlds(self, k):
        """向裁判进程要 k 个重抽了隐藏信息的世界，在本进程导入成 GKMS 会话（要本机 GKMS，算法应设 needs_gkms）。"""
        from . import engine
        from .worlds import import_world
        engine.setup()
        self._chan.send({"op": "worlds", "k": int(k)})
        msg = self._chan.recv()
        if msg.get("op") != "worlds":
            raise RuntimeError(f"要世界时收到 {msg.get('op')}")
        self.worlds_made += k
        return [import_world(base64.b64decode(b)) for b in msg["worlds"]]


class Chan:
    def __init__(self, rin, wout):
        self.rin, self.wout = rin, wout

    def send(self, obj):
        self.wout.write(json.dumps(obj, ensure_ascii=False, default=_jsonable) + "\n")
        self.wout.flush()

    def recv(self):
        line = self.rin.readline()
        if not line:
            raise EOFError("裁判进程关闭了管道")
        return json.loads(line)


def _jsonable(x):
    if isinstance(x, tuple):
        return list(x)
    if hasattr(x, "item"):              # numpy 标量
        return x.item()
    return str(x)


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    proto_out = os.fdopen(os.dup(sys.stdout.fileno()), "w", buffering=1, encoding="utf-8")
    sys.stdout = sys.stderr                     # 算法的 print 不进协议
    chan = Chan(sys.stdin, proto_out)
    from . import algos
    algo = algos.make(argv[0])
    if getattr(algo, "privileged", False):
        chan.send({"op": "error", "error": "提交的算法不能是特权算法（理论上限）"})
        return 2
    if getattr(algo, "needs_gkms", False):
        from . import engine
        engine.setup()
    ctx = None
    while True:
        try:
            msg = chan.recv()
        except EOFError:
            return 0
        op = msg.get("op")
        try:
            if op == "describe":
                chan.send({"op": "describe", "desc": algo.describe(), "about": getattr(algo, "about", None),
                           "needs_gkms": bool(getattr(algo, "needs_gkms", False)), "privileged": False})
            elif op == "begin":
                ctx = HostCtx(chan, msg)
                algo.begin(ctx)
                chan.send({"op": "ok"})
            elif op == "decide":
                ctx.obs = msg["obs"]
                d = algo.decide(ctx)
                chan.send({"op": "decision", "action": list(d.action), "meta": d.meta or {}})
            elif op == "quit":
                return 0
            else:
                chan.send({"op": "error", "error": f"不认识的消息 {op}"})
        except Exception as e:  # noqa: BLE001  算法出错：告诉裁判，这局按当前分数结束
            chan.send({"op": "error", "error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-2000:]})


if __name__ == "__main__":
    sys.exit(main())
