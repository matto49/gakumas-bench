"""评测机：在固定的一台 Mac 上跑仓库里提交的算法，耗时才可比。

提交：在仓库里加 submissions/<名字>/（PR 合进 develop 才会跑），里面放算法文件和 submission.json：
    {"label": "my-algo", "entry": "algo.py:MyAlgo", "params": {"k": 8}, "author": "github-name",
     "sets": ["hif"], "step_seconds": 2}
  label        排行上的名字（3–40 位小写字母、数字、-），全仓库唯一
  entry        文件.py:类名（相对这个目录）
  params       构造参数（可选）
  sets         跑哪些题集（可选，缺省 hif）
  step_seconds 每步时间预算（可选，缺省 5，最多 10）

评测机（这台 Mac 上 launchd 每 15 分钟叫一次 `python -m gkbench runner --once --pull`）：
  1. 拉 develop；2. 找没跑过或改过的提交（按提交目录内容的哈希 + 题集 + 预算 + 规则版本记在 $GKBENCH_DATA/runner/state.json）；
  3. 机器空闲（≥10 分钟没动键鼠、插电、负载低）才开跑，跑的中途有人用电脑就在两局之间停下等；
  4. 算法在 sandbox-exec 子进程里跑（gkbench.sandbox：断网、读不到用户目录和保密种子），裁判在本进程用保密种子；
  5. 跑完上传（服务器逐局重放核对），run.json 里写明 fixed_machine、机器型号和提交来源。
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import platform
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SUBMISSIONS = REPO / "submissions"
OFFICIAL_SETS = ("hif", "nia", "hajime", "idolroad")
LABEL_RE = re.compile(r"^[a-z0-9][a-z0-9-]{2,39}$")
MAX_STEP_SECONDS = 10.0


# ---------------------------------------------------------------- 提交
def load_submissions(root: Path = SUBMISSIONS) -> list[dict]:
    """读全部提交并检查格式；有错的提交带 error 字段（评测机跳过，CI 报错）。"""
    out, labels = [], {}
    for f in sorted(root.glob("*/submission.json")):
        if f.parent.name.startswith((".", "_")):   # _example 等模板不跑
            continue
        d = f.parent
        sub = {"dir": d, "name": d.name}
        try:
            cfg = json.loads(f.read_text(encoding="utf-8"))
            sub.update(cfg)
            label = cfg.get("label") or ""
            if not LABEL_RE.match(label):
                raise ValueError(f"label 要 3–40 位小写字母、数字、-：{label!r}")
            if label in labels:
                raise ValueError(f"label {label} 和 {labels[label]} 重复")
            labels[label] = d.name
            file, _, cls = (cfg.get("entry") or "").partition(":")
            if not file.endswith(".py") or not cls or not (d / file).is_file() or "/" in file.replace("\\", "/").lstrip("./"):
                raise ValueError(f"entry 要写成 本目录里的文件.py:类名：{cfg.get('entry')!r}")
            sets = cfg.get("sets") or ["hif"]
            bad = [s for s in sets if s not in OFFICIAL_SETS]
            if bad:
                raise ValueError(f"sets 只能是 {OFFICIAL_SETS}：{bad}")
            step = float(cfg.get("step_seconds", 5))
            if not 0 < step <= MAX_STEP_SECONDS:
                raise ValueError(f"step_seconds 要在 (0, {MAX_STEP_SECONDS}] 里：{step}")
            if not isinstance(cfg.get("params", {}), dict):
                raise ValueError("params 要是对象")
            sub.update(sets=sets, step_seconds=step, file=file, cls=cls)
        except Exception as e:  # noqa: BLE001
            sub["error"] = f"{type(e).__name__}: {e}"
        out.append(sub)
    return out


def spec_of(sub: dict) -> str:
    params = ",".join(f"{k}={v}" for k, v in (sub.get("params") or {}).items())
    return f"{(sub['dir'] / sub['file']).resolve()}:{sub['cls']}" + (f":{params}" if params else "")


def content_hash(d: Path) -> str:
    h = hashlib.sha256()
    for p in sorted(x for x in d.rglob("*") if x.is_file() and "__pycache__" not in x.parts):
        h.update(str(p.relative_to(d)).encode() + b"\0" + p.read_bytes() + b"\0")
    return h.hexdigest()[:16]


def job_key(sub: dict, set_name: str, rules: int) -> str:
    return f"{sub['label']}|{set_name}|{sub['step_seconds']}|v{rules}|{content_hash(sub['dir'])}"


# ---------------------------------------------------------------- 机器
def _sysctl(name: str) -> str:
    try:
        return subprocess.run(["sysctl", "-n", name], capture_output=True, text=True, timeout=5).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def machine_info() -> dict:
    mem = _sysctl("hw.memsize")
    return {"model": _sysctl("hw.model"), "cpu": _sysctl("machdep.cpu.brand_string"),
            "perf_cores": _sysctl("hw.perflevel0.physicalcpu"), "eff_cores": _sysctl("hw.perflevel1.physicalcpu"),
            "mem_gb": round(int(mem) / 2 ** 30) if mem.isdigit() else None, "os": platform.mac_ver()[0],
            "python": platform.python_version(), "host": platform.node()}


def idle_seconds() -> float | None:
    """macOS：多久没动键盘鼠标（HIDIdleTime）。"""
    try:
        out = subprocess.run(["ioreg", "-c", "IOHIDSystem"], capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    m = re.search(r'"HIDIdleTime" = (\d+)', out)
    return int(m.group(1)) / 1e9 if m else None


def on_ac_power() -> bool | None:
    try:
        out = subprocess.run(["pmset", "-g", "batt"], capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    return "AC Power" in out


def ready(min_idle: float, max_load: float) -> tuple[bool, str]:
    idle, ac, load = idle_seconds(), on_ac_power(), os.getloadavg()[0]
    if idle is not None and idle < min_idle:
        return False, f"有人在用电脑（{idle:.0f}s 前动过键鼠，要 ≥{min_idle:.0f}s）"
    if ac is False:
        return False, "没插电"
    if load > max_load:
        return False, f"负载 {load:.1f} > {max_load}"
    return True, f"空闲 {idle:.0f}s，负载 {load:.1f}"


# ---------------------------------------------------------------- 状态
def _state_path() -> Path:
    from .problems import DATA
    return Path(DATA) / "runner" / "state.json"


def load_state() -> dict:
    p = _state_path()
    return json.loads(p.read_text()) if p.is_file() else {}


def save_state(st: dict) -> None:
    p = _state_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(st, ensure_ascii=False, indent=1))
    tmp.replace(p)


def _git(*args) -> str:
    return subprocess.run(["git", "-C", str(REPO), *args], capture_output=True, text=True, timeout=120).stdout.strip()


# ---------------------------------------------------------------- 跑
def pending_jobs(subs, state, rules):
    jobs = []
    for sub in subs:
        if sub.get("error"):
            continue
        for s in sub["sets"]:
            key = job_key(sub, s, rules)
            if state.get(key, {}).get("status") != "done":
                jobs.append((sub, s, key))
    return jobs


def run_once(*, pull=False, dry_run=False, min_idle=600.0, max_load=3.0, only=None, now=False, upload=True,
             progress=None) -> int:
    progress = progress or (lambda m: print(f"[{datetime.now():%H:%M:%S}] {m}", flush=True))
    from .problems import DATA
    lock_path = Path(DATA) / "runner" / "lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock = open(lock_path, "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        progress("上一次评测还在跑，这次跳过")
        return 0
    if pull:
        _git("fetch", "-q", "origin")
        _git("merge", "--ff-only", "-q", "origin/develop")
    from . import engine
    rules = int(engine.provenance()["rules_version"]) if (engine.GKMS_ROOT / "GakumasCLI").is_dir() else 0
    subs = load_submissions()
    for s in subs:
        if s.get("error"):
            progress(f"提交 {s['name']} 格式不对，跳过：{s['error']}")
    state = load_state()
    jobs = [j for j in pending_jobs(subs, state, rules) if not only or j[0]["label"] in only]
    if not jobs:
        progress("没有要跑的提交")
        return 0
    progress(f"{len(jobs)} 项待跑：" + "、".join(f"{s['label']}@{t}" for s, t, _ in jobs))
    if dry_run:
        return 0
    if not now:
        ok, why = ready(min_idle, max_load)
        if not ok:
            progress(f"先不跑：{why}")
            return 0
    from .runner import run
    from .sandbox import SandboxedAlgo
    commit = _git("rev-parse", "HEAD")
    mach = machine_info()

    def between():                              # 两局之间：有人用电脑就等，计时才干净
        if now:
            return
        waited = 0.0
        while True:
            ok, why = ready(min_idle / 5, max_load)
            if ok:
                if waited:
                    progress(f"继续（等了 {waited / 60:.0f} 分钟）")
                return
            if waited == 0:
                progress(f"暂停：{why}")
            time.sleep(30)
            waited += 30

    done = 0
    for sub, set_name, key in jobs:
        progress(f"开跑 {sub['label']} @ {set_name}（每步 {sub['step_seconds']}s）")
        state[key] = {"status": "running", "at": datetime.now(timezone.utc).isoformat(), "label": sub["label"]}
        save_state(state)
        algo = None
        try:
            algo = SandboxedAlgo(spec_of(sub))
            extra = {"fixed_machine": True, "machine": f"{mach['model']} · {mach['cpu']} · {mach['mem_gb']} GB",
                     "machine_info": mach, "sandbox": "sandbox-exec",
                     "submission": {"dir": f"submissions/{sub['name']}", "commit": commit, "author": sub.get("author"),
                                    "hash": content_hash(sub["dir"]), "entry": sub["entry"], "params": sub.get("params") or {}},
                     "about": algo.about, "load_start": round(os.getloadavg()[0], 2)}
            out = run(set_name, algo, sub["step_seconds"], None, None, sub["label"], keep_obs=True, template=True,
                      by=sub.get("author"), extra=extra, between=between,
                      progress=lambda m: None)
            info = json.loads((out / "run.json").read_text())
            info["load_end"] = round(os.getloadavg()[0], 2)
            (out / "run.json").write_text(json.dumps(info, ensure_ascii=False, indent=1))
            progress(f"跑完 {sub['label']} @ {set_name}：{info.get('episodes')} 局，均分 {info.get('mean_score'):,}")
            if upload:
                from .client import upload as up
                r = up(out)
                progress(f"上传：{r.get('status')} 收下 {r.get('accepted')}")
            state[key] = {"status": "done", "at": datetime.now(timezone.utc).isoformat(), "label": sub["label"],
                          "run": out.name}
            done += 1
        except Exception as e:  # noqa: BLE001  一个提交出错不影响别的
            tail = algo.tail_stderr() if algo is not None else ""
            state[key] = {"status": "error", "at": datetime.now(timezone.utc).isoformat(), "label": sub["label"],
                          "error": f"{type(e).__name__}: {e}"[:500], "stderr": tail[-800:]}
            progress(f"出错 {sub['label']} @ {set_name}：{e}")
        finally:
            if algo is not None:
                algo.close()
            save_state(state)
    return done


LAUNCHD_LABEL = "top.matto.gkbench-runner"


def install_launchd(interval=900) -> Path:
    """装 launchd 定时任务：每 interval 秒叫一次 runner --once --pull。日志在 $GKBENCH_DATA/runner/。"""
    from .problems import DATA
    logs = Path(DATA) / "runner"
    logs.mkdir(parents=True, exist_ok=True)
    plist = Path.home() / "Library/LaunchAgents" / f"{LAUNCHD_LABEL}.plist"
    env = {k: os.environ[k] for k in ("GKBENCH_DATA", "GKMS_ROOT", "GKMSCLIGPU_LIB", "GKMS_UINET_REPO", "GKBENCH_SERVER")
           if os.environ.get(k)}
    env["PYTHONPATH"] = str(REPO)
    env_xml = "".join(f"<key>{k}</key><string>{v}</string>" for k, v in env.items())
    plist.write_text(f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>{LAUNCHD_LABEL}</string>
<key>ProgramArguments</key><array><string>{sys.executable}</string><string>-m</string><string>gkbench</string>
<string>runner</string><string>--once</string><string>--pull</string></array>
<key>WorkingDirectory</key><string>{REPO}</string>
<key>EnvironmentVariables</key><dict>{env_xml}</dict>
<key>StartInterval</key><integer>{int(interval)}</integer>
<key>LowPriorityIO</key><false/>
<key>StandardOutPath</key><string>{logs / 'runner.log'}</string>
<key>StandardErrorPath</key><string>{logs / 'runner.err.log'}</string>
</dict></plist>
""")
    subprocess.run(["launchctl", "unload", str(plist)], capture_output=True)
    subprocess.run(["launchctl", "load", str(plist)], check=True)
    return plist
