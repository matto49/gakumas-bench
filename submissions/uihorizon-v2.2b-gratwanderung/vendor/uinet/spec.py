"""The two input versions of the network: which encoder, vocabulary and array widths a checkpoint was built for.

  v1  uinet.feat / uinet.encode, schema/vocab.v1.json (Ver1.0, Ver1.1 and every SX-04 model up to SX-04-18)
  v2  uinet.feat2 / uinet.encode2, schema/vocab.v2.json (SX-04-19: every field the engine reads, UIObs v2)

A checkpoint records ``obs`` ("v1" when absent); an ONNX export is told apart by its t_rel input (v2) / s_num width.
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache


@dataclass(frozen=True)
class Spec:
    obs: str
    slot_cat: tuple
    slot_num: tuple
    slots: int
    thing_cat: tuple
    n_thing_num: int
    t_ext: int
    n_kinds: int
    g_num: int
    slot_field: dict
    thing_field: dict
    vocab_fields: tuple
    g_cat: tuple = ("plan", "step", "produce", "stance")
    inputs: tuple = ()
    rel_bits: int = 0


@lru_cache(maxsize=None)
def get(obs="v1"):
    if obs == "v1":
        from . import encode as E
        from . import feat as F
        return Spec("v1", F.SLOT_CAT, F.SLOT_NUM, F.SLOTS, F.THING_CAT, len(F.THING_NUM), E.T_EXT, E.N_KINDS, E.G_NUM,
                    {f: f for f in F.SLOT_CAT},
                    {"category": "category", "rarity": "rarity", "plan": "plan", "ctype": "ctype", "mpos": "mpos",
                     "cfstat": "fstat", "cphase": "phase", "origin": "origin"}, F.VOCAB_FIELDS, inputs=E.INPUTS)
    if obs == "v2":
        from . import encode2 as E
        from . import feat2 as F
        _v, groups = F.load_vocab2()
        return Spec("v2", F.SLOT_CAT, F.SLOT_NUM, F.SLOTS, F.THING_CAT, len(F.THING_NUM_V1) + len(groups) + 8,
                    E.T_EXT, E.N_KINDS, E.G_NUM, dict(F.SLOT_FIELD), dict(F.THING_FIELD), F.VOCAB_FIELDS,
                    g_cat=E.G_CAT, inputs=E.INPUTS, rel_bits=E.REL_BITS)
    raise ValueError(f"unknown observation version {obs!r}")


def vocab(obs="v1"):
    if obs == "v1":
        from .feat import Vocab
        return Vocab.load()
    from .feat2 import load_vocab2
    return load_vocab2()[0]


def encoder(obs="v1"):
    if obs == "v1":
        from .encode import Encoder
        return Encoder()
    from .encode2 import Encoder2
    return Encoder2()


def collate(obs="v1"):
    if obs == "v1":
        from .encode import collate as c
    else:
        from .encode2 import collate as c
    return c


def of_onnx_inputs(inputs):
    """'v1' or 'v2' from an onnxruntime session's inputs (a t_rel input, or the s_num width: 14 or wider)."""
    if any(i.name == "t_rel" for i in inputs):
        return "v2"
    for i in inputs:
        if i.name == "s_num":
            return "v1" if int(i.shape[-1]) == len(get("v1").slot_num) else "v2"
    return "v1"
