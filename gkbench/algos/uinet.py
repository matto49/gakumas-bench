"""UINet：GKMS 公开的只看画面出牌网络（github.com/yuzeis/GKMSUINet，MIT），ONNX 推理。

  GKMS_UINET_REPO     公开仓库克隆，默认 ~/github/_ext/GKMSUINet（模型在 model/gkms_uinet.onnx）；pip 装了 gkms-uinet 时不需要
  GKMS_UINET_MODEL    模型文件（缺省：仓库克隆里的 model/gkms_uinet.onnx）
  GKBENCH_UINET_MASTER  主数据目录（9 张表，.jsonl / .yaml）；缺省用本机 GKMS 的主数据
参数：model=…、master=…（优先于环境变量）、threads=4。给了 master 就不需要 GKMS。
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from .base import Algorithm, Decision

REPO = Path(os.environ.get("GKMS_UINET_REPO", Path.home() / "github/_ext/GKMSUINet")).expanduser().resolve()


class UinetAlgo(Algorithm):
    name = "uinet"
    needs_gkms = True                           # 要 GKMS 的主数据表

    def __init__(self, model=None, threads=4, master=None, **kw):
        super().__init__(model=model, threads=threads, **kw)
        try:
            from gkms_uinet import Policy
        except ImportError:
            if str(REPO) not in sys.path:
                sys.path.insert(0, str(REPO))
            from gkms_uinet import Policy
        model = model or os.environ.get("GKMS_UINET_MODEL")
        master = master or os.environ.get("GKBENCH_UINET_MASTER")
        if not master:
            from ..engine import MASTER_DIR
            master = MASTER_DIR
        self.model = Path(model).expanduser().resolve() if model else REPO / "model" / "gkms_uinet.onnx"
        self.policy = Policy(self.model, str(master), threads=int(threads))

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
