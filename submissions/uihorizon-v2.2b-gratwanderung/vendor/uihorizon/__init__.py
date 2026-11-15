"""UIHorizon (SX-05, internal research): the UI network with the draw pile's true order in its input.

The model is UIHorizon-v2.0Preview-Freiheitsmasik.  It is GKMSUINet's v2 network (same arrays, same widths, so a
GKMSUINet v2 checkpoint initialises it) reading one more thing: the order in which the draw pile will be drawn,
which a seed inferred from the screen fixes (GKMSProject GakumasCLI/tools/hif_seed_solve.py).  Nothing of
GKMSProject is changed: this package imports ``uinet`` (GKMSProject GKMSUINet/) and the engine it points at.

    PYTHONPATH=<GKMSProject>/GKMSUINet:<GKMSResearch>/research/sx05 python3 -B -m uihorizon.<gen|train|export|evaluate> ...

  encode    HorizonEncoder: uinet.encode2.Encoder2 + the pile order in the pile cards' free t_ext columns
  play      Net (a network and whether it reads the order), HorizonArm (base network before the seed is locked,
            then the network alone or with a one-step lookahead in the true world)
  gen       labels: every legal action played in the true world, the network plays it to the end
  train     uinet.train with HorizonEncoder; marks the checkpoint
  export    uinet.export; marks the ONNX file
  evaluate  game play on uinet.evaluate's sets, and the paired report
"""
MODEL_NAME = "UIHorizon-v2.0Preview-Freiheitsmasik"
MARK = "horizon"                      # checkpoint key / ONNX metadata key of a network that reads the pile order


def hobs(battle):
    """The battle's UIObs with the draw pile in draw order (first = the next card drawn) and ``order`` = 1.
    ``uinet.uiobs.from_session`` lists the pile sorted, as the screen shows it."""
    from uinet.uiobs import card_spec
    o = battle.obs()
    o["deck"] = [card_spec(c) for c in battle.session.deck.deck]
    o["order"] = 1
    return o


def install():
    """Make ``uinet.spec.encoder("v2")`` return a HorizonEncoder, for the uinet entry points this package wraps
    (train, export).  An observation without ``order`` encodes exactly as Encoder2 encodes it."""
    from uinet import spec
    from .encode import HorizonEncoder
    if getattr(spec.encoder, "_horizon", False):
        return
    orig = spec.encoder

    def encoder(obs="v1"):
        return HorizonEncoder() if obs == "v2" else orig(obs)
    encoder._horizon = True
    spec.encoder = encoder
