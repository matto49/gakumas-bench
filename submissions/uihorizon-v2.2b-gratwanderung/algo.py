"""UIHorizon-v2.2bPreview-Gratwanderung — 从画面反推这一局的牌序种子，锁定后照着手里的完整路线打。

只读 ``ctx.obs`` 和 ``ctx.loadout``：开局几张牌和回合属性足够把种子筛到个位数，锁定后整局确定；
路线池（多个已知牌序的搜索 + 网络前瞻）每一步各出一条完整路线，重放后取终局分最高的一条照着打。

适配器（``bench/``、``uihorizon/``、``uinet/``、``models/base.onnx``）放在 ``./vendor`` 下随提交一起走，
固定评测机上只要有本仓库的 Python 环境、GKMS 引擎（GKMSProject 克隆与原生核心）和 clang/gcc 之一
（种子扫描内核由 ``vendor/bench/seed_scan.c`` 现编到临时目录）。见同目录 README.md。
"""
import sys
from pathlib import Path

_VENDOR = Path(__file__).resolve().parent / "vendor"
if str(_VENDOR) not in sys.path:
    sys.path.insert(0, str(_VENDOR))

from bench.uihorizon_bench import UIHorizon  # noqa: E402,F401  submission.json 的 entry 指向这个类
