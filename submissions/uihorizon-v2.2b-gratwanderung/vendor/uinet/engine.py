"""Where the engine and the native core come from, and loading them once per process.

GKMSUINet reads the engine, the native core and the workbench helpers (GakumasCLI, the ``GakumasCLI`` package) of the
GKMSProject checkout it sits in, and never writes them.  A cloud or research run can point at another checkout
(a snapshot of one commit) with UINET_PROJECT; engine and native core then both come from that checkout, which is
the SX-03-05 rule: the two always from the same commit.

Engine code reads some tables by relative path, so ``setup()`` changes the working directory to the engine root,
as every engine entry point does.
"""
from __future__ import annotations

import json
import os
import sys
from functools import lru_cache
from pathlib import Path

HERE = Path(__file__).resolve().parent
TREE = HERE.parent                                            # GKMSProject/GKMSUINet
PROJECT = Path(os.environ.get("UINET_PROJECT") or TREE.parent).resolve()
ENGINE = PROJECT / "GakumasCLI"
NATIVE = WORKBENCH = ENGINE                                   # rev277: one tree (native/, data/, priors/)
MASTER_DIR = ENGINE / "ro" / "master" / "tables"
PRIOR = WORKBENCH / "priors" / "prior_generated_only.json"   # the production prior (norng used it too)

_READY = False


def setup(chdir=True):
    """Put the project root (the GakumasCLI package) on sys.path (once)."""
    global _READY
    if not _READY:
        for p in (str(PROJECT),):
            if p not in sys.path:
                sys.path.insert(0, p)
        _READY = True
    if chdir:
        os.chdir(ENGINE)


@lru_cache(maxsize=1)
def master():
    setup()
    from GakumasCLI.scenario.exam_session import Master
    return Master.load(MASTER_DIR)


def native_lib_path():
    """The Linux build `GakumasCLI/native/build.sh` writes, or UINET_NATIVE_LIB."""
    return Path(os.environ.get("UINET_NATIVE_LIB") or (NATIVE / "native" / "libgkmscore.so"))


@lru_cache(maxsize=1)
def native():
    """(Native, NativeSearch) on this process's master; None when the library is missing."""
    setup()
    lib = native_lib_path()
    if not lib.is_file():
        return None
    from GakumasCLI.native.diffrun import Native
    from GakumasCLI.native.native_search import NativeSearch
    nat = Native(str(lib))
    nat.load_master(master(), json.load(open(NATIVE / "data" / "strings.json", encoding="utf-8")))
    return nat, NativeSearch(nat)


@lru_cache(maxsize=1)
def prior():
    setup()
    from GakumasCLI.scenario import policy_search as PS
    return PS.load_prior(str(PRIOR))


def shuffle_pile(session, rnd):
    """Reorder the session's draw pile with RND's shuffle.  The native session (engine rev294b) keeps its piles in
    the core: a pile is rewritten through ``session.edit``; the same permutation as a list shuffle."""
    if hasattr(session, "edit"):
        session.edit(lambda v: rnd.shuffle(v.deck.deck))
    else:
        rnd.shuffle(session.deck.deck)


def build(loadout, seed=None):
    """(session, meta) of one H.I.F battle from a ``gkms.hif_loadout.v1`` document."""
    setup()
    from GakumasCLI.scenario.hif import build_hif_loadout_session
    return build_hif_loadout_session(master(), loadout, seed)


def project_commit():
    """The checkout's HEAD, for the provenance of every output; a tree unpacked from ``git archive`` carries it in a
    ``COMMIT`` file at its root (None when neither is there)."""
    head = PROJECT / ".git" / "HEAD"
    try:
        ref = head.read_text().strip()
        if ref.startswith("ref: "):
            return (PROJECT / ".git" / ref[5:]).read_text().strip()
        return ref
    except OSError:
        pass
    try:
        return (PROJECT / "COMMIT").read_text().strip() or None
    except OSError:
        return None


def exam_rules_version():
    """gk_exam_rules_version of the native core this process uses (what an episode's play depends on)."""
    setup()
    from GakumasCLI.native.native_session import _lib
    return int(_lib().exam_rules_version)
