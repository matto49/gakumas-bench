"""把一个算法关进 macOS 沙盒（sandbox-exec）的子进程里跑，裁判留在本进程。

为什么要两个进程：本机跑分时裁判握着种子和真实局面，算法和它同一个进程就能翻内存（gc、栈帧）拿到种子，
或者直接读 $GKBENCH_DATA/private 里的保密种子。拆开后算法进程只经管道拿公开观测（gkbench.algo_host），
沙盒再挡住：联网、读用户目录（只放行仓库、Python、GKMS、本次的临时目录）、写临时目录以外的地方。

SandboxedAlgo 对 runner 来说就是一个普通 Algorithm：decide(ctx) 把观测发过去、等动作回来；
算法要世界时，本进程用裁判采样（ctx.worlds，和本机跑的内置算法同一套随机数）、导出后发过去。
计时由 runner 在 decide 外面量，含一次管道往返（约 1 ms 以内）。
"""
from __future__ import annotations

import base64
import json
import os
import select
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from . import engine
from .algos.base import Algorithm, Decision

REPO = Path(__file__).resolve().parents[1]


def _q(p) -> str:
    return json.dumps(str(Path(p).resolve()))


def profile(scratch: Path, extra_read=()) -> str:
    """sandbox-exec 规则：默认放行（Python 要读很多系统文件），再按下面收紧。"""
    home = Path.home().resolve()
    reads = [REPO, Path(sys.prefix), Path(sys.base_prefix), engine.GKMS_ROOT, scratch, *extra_read]
    uinet = os.environ.get("GKMS_UINET_REPO")
    if uinet:
        reads.append(Path(uinet).expanduser())
    allow_read = "\n".join(f"  (subpath {_q(p)})" for p in reads if Path(p).exists())
    return f"""(version 1)
(allow default)
(deny network*)
(deny file-write*)
(allow file-write*
  (subpath {_q(scratch)})
  (subpath "/private/var/folders")
  (literal "/dev/null") (literal "/dev/tty") (literal "/dev/dtracehelper"))
(deny file-read* (subpath {_q(home)}))
(allow file-read*
  (literal {_q(home)})
{allow_read})
"""


class SandboxError(RuntimeError):
    pass


class SandboxedAlgo(Algorithm):
    """沙盒子进程里的算法。spec 同 --algo（提交的算法一般是 文件.py:类名）。"""

    def __init__(self, spec: str, *, step_timeout: float | None = None, extra_read=(), sandbox=True, base_dir=None):
        target, sep, rest = spec.partition(":")
        if target.endswith(".py") and not Path(target).is_absolute():   # 文件写法换成绝对路径（子进程的 cwd 是临时目录）
            spec = str((Path(base_dir) if base_dir else Path.cwd()).joinpath(target).resolve()) + sep + rest
        self.spec = spec
        self.scratch = Path(tempfile.mkdtemp(prefix="gkbench-algo-"))
        (self.scratch / "tmp").mkdir()
        self.step_timeout = step_timeout
        cmd = [sys.executable, "-s", "-m", "gkbench.algo_host", spec]
        if sandbox:
            if not shutil.which("sandbox-exec"):
                raise SystemExit("这台机器没有 sandbox-exec（只有 macOS 有）：不能在沙盒里跑提交的算法")
            prof = self.scratch / "sandbox.sb"
            prof.write_text(profile(self.scratch, extra_read))
            cmd = ["sandbox-exec", "-f", str(prof), *cmd]
        env = {"PATH": "/usr/bin:/bin", "HOME": str(self.scratch), "TMPDIR": str(self.scratch / "tmp"),
               "PYTHONPATH": str(REPO), "PYTHONNOUSERSITE": "1", "PYTHONUNBUFFERED": "1", "LANG": "en_US.UTF-8",
               "GKMS_ROOT": str(engine.GKMS_ROOT), "GKMSCLIGPU_LIB": str(engine.NATIVE_LIB)}
        for k in ("GKMS_UINET_REPO", "GKMSCLIGPU_STRINGS", "OMP_NUM_THREADS"):
            if os.environ.get(k):
                env[k] = os.environ[k]
        self.proc = subprocess.Popen(cmd, cwd=str(self.scratch), env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=open(self.scratch / "algo.stderr.log", "w"), text=True, bufsize=1)
        hello = self._call({"op": "describe"}, timeout=120)
        if hello.get("op") != "describe":
            raise SandboxError(f"算法进程没起来：{hello}；stderr 见 {self.scratch / 'algo.stderr.log'}")
        desc = hello["desc"]
        self.name = desc["name"]
        self.params = desc.get("params") or {}
        self.about = hello.get("about")
        self.needs_gkms = hello.get("needs_gkms", False)
        self.privileged = False
        self._desc = desc

    def describe(self) -> dict:
        return dict(self._desc, privileged=False)

    # -- 管道
    def _send(self, obj):
        try:
            self.proc.stdin.write(json.dumps(obj, ensure_ascii=False) + "\n")
            self.proc.stdin.flush()
        except BrokenPipeError:
            raise SandboxError(f"算法进程已退出：{self.tail_stderr()}") from None

    def _recv(self, timeout):
        deadline = None if timeout is None else time.monotonic() + timeout
        while True:
            left = None if deadline is None else max(0.0, deadline - time.monotonic())
            r, _, _ = select.select([self.proc.stdout], [], [], left)
            if r:
                line = self.proc.stdout.readline()
                if not line:
                    raise SandboxError(f"算法进程已退出：{self.tail_stderr()}")
                return json.loads(line)
            if deadline is not None and time.monotonic() >= deadline:
                self.close()
                raise SandboxError(f"算法 {timeout:.0f} 秒没有回应，已结束它")

    def _call(self, obj, ctx=None, timeout=None):
        """发一条消息，等最终回复；中间算法要世界就用 ctx（裁判）采样、导出后发回去。"""
        self._send(obj)
        while True:
            msg = self._recv(timeout)
            if msg.get("op") == "worlds":
                if ctx is None:
                    raise SandboxError("算法在不能要世界的时候要了世界")
                from .worlds import export_world
                ws = ctx.worlds(int(msg["k"]))
                self._send({"op": "worlds", "worlds": [base64.b64encode(export_world(w)).decode() for w in ws]})
                continue
            if msg.get("op") == "error":
                raise SandboxError(msg.get("error") or "算法出错")
            return msg

    def _timeout(self, ctx):
        if self.step_timeout is not None:
            return self.step_timeout
        return float(ctx.budget or 5) * 3 + 30          # 超时只按记录算，这里只防卡死

    # -- Algorithm
    def begin(self, ctx):
        self._call({"op": "begin", "obs": ctx.obs, "budget": ctx.budget, "loadout": ctx.loadout, "meta": ctx.meta,
                    "rng": ctx.rng.getrandbits(63)}, ctx, timeout=self._timeout(ctx) + 60)

    def decide(self, ctx):
        msg = self._call({"op": "decide", "obs": ctx.obs}, ctx, timeout=self._timeout(ctx))
        return Decision(tuple(msg["action"]), msg.get("meta") or {})

    def tail_stderr(self, n=1500) -> str:
        try:
            return (self.scratch / "algo.stderr.log").read_text(errors="replace")[-n:]
        except OSError:
            return ""

    def close(self):
        if self.proc.poll() is None:
            try:
                self._send({"op": "quit"})
                self.proc.wait(timeout=5)
            except Exception:
                self.proc.kill()

    def __del__(self):
        try:
            self.close()
        except Exception:
            pass
