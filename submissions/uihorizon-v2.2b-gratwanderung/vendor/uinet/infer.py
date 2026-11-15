"""The network for its users: one screen in, the choice out.  No engine, no search -- onnxruntime and the features.

    from uinet.infer import Policy
    p = Policy("gkms_uinet.onnx")
    out = p.decide(uiobs)          # uiobs: a UIObs v1 document (uinet/uiobs.py)
    out["action"]                  # e.g. ["play", 2]
    out["probs"]                   # one probability per entry of uiobs["legal"]
    out["score_quantiles"]         # the predicted final score at 10 / 25 / 50 / 75 / 90 %

The features of cards, drinks and lasting effects are read from the master tables: a v1 model (Ver1.x) reads
uinet.feat and schema/vocab.v1.json, a v2 model (SX-04-19) uinet.feat2 and schema/vocab.v2.json -- told apart by
the ONNX inputs (uinet.spec).  A v2 model needs a UIObs v2 document; a v1 model reads either.
"""
from __future__ import annotations

import math

import numpy as np

from .encode import QUANTILES, VALUE_SHIFT


class Policy:
    def __init__(self, onnx_path, threads=1):
        import onnxruntime as ort
        so = ort.SessionOptions()
        so.intra_op_num_threads = threads
        self.sess = ort.InferenceSession(str(onnx_path), so, providers=["CPUExecutionProvider"])
        from .spec import encoder, of_onnx_inputs
        self.obs = of_onnx_inputs(self.sess.get_inputs())
        self.enc = encoder(self.obs)
        self.inputs = [i.name for i in self.sess.get_inputs()]

    def decide(self, obs, greedy=True, rng=None):
        batch = self.enc.encode(obs)
        logit, _adv, value = self.sess.run(["logit", "adv", "value"], {k: batch[k] for k in self.inputs})
        n = len(obs["legal"])
        z = logit[0, :n] - logit[0, :n].max()
        probs = np.exp(z) / np.exp(z).sum()
        k = int(np.argmax(probs)) if greedy else int((rng or np.random.default_rng()).choice(n, p=probs))
        return {"action": list(obs["legal"][k]), "probs": [float(x) for x in probs],
                "score_quantiles": {f"{int(q * 100)}%": int(math.exp(float(v) + VALUE_SHIFT))
                                    for q, v in zip(QUANTILES, value[0])}}
