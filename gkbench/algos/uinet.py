"""UINet：GKMS 公开的只看画面出牌网络（github.com/yuzeis/GKMSUINet，MIT），ONNX 推理。

  GKMS_UINET_REPO   公开仓库克隆，默认 ~/github/_ext/GKMSUINet（模型在 model/gkms_uinet.onnx）
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from .base import Algorithm, Decision

REPO = Path(os.environ.get("GKMS_UINET_REPO", Path.home() / "github/_ext/GKMSUINet")).expanduser().resolve()


class UinetAlgo(Algorithm):
    name = "uinet"

    def __init__(self, model=None, threads=4, **kw):
        super().__init__(model=model, threads=threads, **kw)
        if str(REPO) not in sys.path:
            sys.path.insert(0, str(REPO))
        from gkms_uinet import Policy
        from ..engine import MASTER_DIR
        self.model = Path(model).expanduser().resolve() if model else REPO / "model" / "gkms_uinet.onnx"
        self.policy = Policy(self.model, str(MASTER_DIR), threads=int(threads))

    def describe(self):
        d = super().describe()
        d["model_file"] = self.model.name
        return d

    def decide(self, ctx):
        obs = {k: v for k, v in ctx.obs.items() if k != "i"}
        out = self.policy.decide(obs)
        probs = out["probs"]
        top = sorted(range(len(probs)), key=probs.__getitem__, reverse=True)[:3]
        return Decision(tuple(out["action"]), {
            "top": [[obs["legal"][i], round(probs[i], 3)] for i in top],
            "score_quantiles": out["score_quantiles"]})
