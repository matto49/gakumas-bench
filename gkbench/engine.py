"""GKMS 引擎接入：按需加载 GKMSProject 的考试引擎、原生核心和主数据，每个进程只加载一次。

GKMS 不在本仓库里（私有、无许可证），按路径引用本机克隆：
  GKMS_ROOT        GKMSProject 克隆，默认 ~/github/_ext/GKMSProject
  GKMSCLIGPU_LIB   原生核心库，默认 $GKMS_ROOT/GakumasCLI/native/build/libgkmscore.dylib（Linux 为 .so）

GKMS 引擎按相对路径读部分表，加载时会把当前目录切到 GakumasCLI；本仓库的路径一律先转成绝对路径。
"""
from __future__ import annotations

import os
import sys
from functools import lru_cache
from pathlib import Path

GKMS_ROOT = Path(os.environ.get("GKMS_ROOT", Path.home() / "github/_ext/GKMSProject")).expanduser().resolve()
_EXT = ".dylib" if sys.platform == "darwin" else ".so"
NATIVE_LIB = Path(os.environ.get("GKMSCLIGPU_LIB",
                                 GKMS_ROOT / "GakumasCLI/native/build" / f"libgkmscore{_EXT}")).expanduser().resolve()
MASTER_DIR = GKMS_ROOT / "GakumasCLI/ro/master/tables"


def setup():
    os.environ["GKMSCLIGPU_LIB"] = str(NATIVE_LIB)
    os.environ.setdefault("UINET_NATIVE_LIB", str(NATIVE_LIB))
    for p in (str(GKMS_ROOT), str(GKMS_ROOT / "GKMSUINet")):
        if p not in sys.path:
            sys.path.insert(0, p)
    from uinet import engine as ue
    ue.setup()
    _cache_tower_catalog()
    return ue


_TOWER_CACHED = False


def _cache_tower_catalog():
    """GKMS 每开一局带初始卡的考试都会重新读一遍塔的主数据（TowerCatalog.load，十几张大表），占开局时间的七成。
    主数据在进程里不变，按 (目录, 塔) 缓存。只在本进程生效，不改 GKMS 源码。"""
    global _TOWER_CACHED
    if _TOWER_CACHED:
        return
    from GakumasCLI.engine.tower import TowerCatalog
    orig = TowerCatalog.load.__func__
    cache = {}

    def load(cls, master_dir, *args, **kw):
        key = (cls, str(master_dir), args, tuple(sorted(kw.items())))
        if key not in cache:
            cache[key] = orig(cls, master_dir, *args, **kw)
        return cache[key]

    TowerCatalog.load = classmethod(load)
    _TOWER_CACHED = True


@lru_cache(maxsize=1)
def master():
    return setup().master()


@lru_cache(maxsize=1)
def native():
    """(Native, NativeSearch)。"""
    pair = setup().native()
    if pair is None:
        raise RuntimeError(f"缺原生核心 {NATIVE_LIB}，见 README 的编译步骤")
    return pair


@lru_cache(maxsize=1)
def prior():
    return setup().prior()


def build(loadout: dict, seed: int):
    """(session, meta)：按开局配置和种子开一场考试。"""
    ue = setup()
    doc = {k: v for k, v in loadout.items() if not k.startswith("_") and k != "source"}
    doc["seed"] = int(seed)
    return ue.build(doc, None)


@lru_cache(maxsize=1)
def provenance() -> dict:
    """引擎来源：GKMS 提交、规则版本、主数据版本。每次运行都记下来，引擎更新后旧成绩可以重算。"""
    ue = setup()
    nat, _ = native()
    master_version = None
    mv = MASTER_DIR.parent / "VERSION"
    if mv.is_file():
        master_version = mv.read_text().strip()
    return {"engine": "gkms-native", "gkms_commit": ue.project_commit(),
            "rules_version": int(getattr(nat, "exam_rules_version", 0)), "master_version": master_version}
