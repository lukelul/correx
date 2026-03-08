"""
5_reexport_tfjs.py — Re-export CorrexVerifier using tf_keras (Keras 2 compat)
so the resulting model.json is compatible with TF.js 4.x.

TF 2.20 ships Keras 3 by default; tf_keras is the Keras 2 compatibility layer
that TF.js understands (batch_input_shape, simple inbound_nodes format, etc.).
"""

import sys
from unittest.mock import MagicMock

# Mock missing optional deps before importing tensorflowjs
jax_mock = MagicMock()
jax_mock.__path__ = []
sys.modules["tensorflow_decision_forests"] = MagicMock()
sys.modules["jax"] = jax_mock
sys.modules["jax.numpy"] = MagicMock()
sys.modules["jax.experimental"] = MagicMock()
sys.modules["flax"] = MagicMock()

import json
import logging
import argparse
from pathlib import Path

import numpy as np
import torch

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

PT_MODEL  = Path("models/correx_verifier.pt")
TFJS_OUT  = Path("models/tfjs")

CLASSES    = ["success", "wrong_item", "drop_detected", "placement_miss", "grip_failure"]
SEQ_LEN    = 16
IMG_SIZE   = 224
CLIP_DIM   = 512
GRU_HIDDEN = 256
N_CLASSES  = 5


def load_pytorch_weights(pt_path: Path):
    checkpoint = torch.load(pt_path, map_location="cpu")
    state = checkpoint.get("model_state", checkpoint)
    gru_state  = {k.replace("gru.", ""): v for k, v in state.items() if k.startswith("gru.")}
    head_state = {k.replace("head.", ""): v for k, v in state.items() if k.startswith("head.")}
    return gru_state, head_state


def build_model_tfkeras(gru_state, head_state):
    import tf_keras as keras
    import tensorflow as tf

    log.info("Building model with tf_keras (Keras 2 compat)…")

    # MobileNetV2 backbone via tf_keras
    base = keras.applications.MobileNetV2(
        input_shape=(IMG_SIZE, IMG_SIZE, 3),
        include_top=False,
        pooling="avg",
        weights="imagenet",
    )
    base.trainable = False

    frame_in  = keras.Input(shape=(IMG_SIZE, IMG_SIZE, 3), name="frame_input")
    frame_out = base(frame_in, training=False)
    proj_out  = keras.layers.Dense(CLIP_DIM, name="proj")(frame_out)
    frame_enc = keras.Model(frame_in, proj_out, name="frame_encoder")

    seq_in  = keras.Input(shape=(SEQ_LEN, IMG_SIZE, IMG_SIZE, 3), name="sequence_input")
    enc_out = keras.layers.TimeDistributed(frame_enc, name="td_encoder")(seq_in)
    # reset_after=False: TF.js does not support reset_after=True (cuDNN variant)
    gru_out = keras.layers.GRU(GRU_HIDDEN, name="gru", return_sequences=False,
                                reset_after=False, implementation=1)(enc_out)
    drop    = keras.layers.Dropout(0.0, name="dropout")(gru_out)
    logits  = keras.layers.Dense(N_CLASSES, name="head")(drop)
    probs   = keras.layers.Softmax(name="softmax")(logits)
    model   = keras.Model(seq_in, probs, name="CorrexVerifier")

    model.summary(line_length=80)

    # Transfer GRU weights from PyTorch
    # reset_after=False uses single combined bias [3H] = bih + bhh
    if gru_state:
        try:
            wih = gru_state.get("weight_ih_l0")  # [3H, D]
            whh = gru_state.get("weight_hh_l0")  # [3H, H]
            bih = gru_state.get("bias_ih_l0")    # [3H]
            bhh = gru_state.get("bias_hh_l0")    # [3H]
            H = wih.shape[0] // 3
            combined_bias = (
                (bih.numpy() if bih is not None else np.zeros(3 * H)) +
                (bhh.numpy() if bhh is not None else np.zeros(3 * H))
            )
            gru_layer = model.get_layer("gru")
            gru_layer.set_weights([
                wih.numpy().T,   # kernel [D, 3H]
                whh.numpy().T,   # recurrent_kernel [H, 3H]
                combined_bias,   # bias [3H]
            ])
            log.info("GRU weights transferred (reset_after=False, combined bias)")
        except Exception as e:
            log.warning(f"GRU transfer failed: {e}")

    # Transfer head weights from PyTorch
    if head_state:
        try:
            w = head_state.get("1.weight")
            b = head_state.get("1.bias")
            if w is not None:
                model.get_layer("head").set_weights([
                    w.numpy().T,
                    b.numpy() if b is not None else np.zeros(N_CLASSES),
                ])
                log.info("Head weights transferred")
        except Exception as e:
            log.warning(f"Head transfer failed: {e}")

    return model


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pt",  default=str(PT_MODEL))
    parser.add_argument("--out", default=str(TFJS_OUT))
    parser.add_argument("--quantize", action="store_true")
    args = parser.parse_args()

    pt_path = Path(args.pt)
    out_dir = Path(args.out)

    log.info(f"Loading PyTorch checkpoint: {pt_path}")
    gru_state, head_state = load_pytorch_weights(pt_path)

    model = build_model_tfkeras(gru_state, head_state)

    import tensorflowjs as tfjs

    out_dir.mkdir(parents=True, exist_ok=True)
    if args.quantize:
        log.info("Exporting with uint8 quantization…")
        tfjs.converters.save_keras_model(
            model, str(out_dir),
            quantization_dtype_map={"float32": "uint8"},
        )
    else:
        log.info("Exporting without quantization…")
        tfjs.converters.save_keras_model(model, str(out_dir))

    # Overwrite metadata
    meta = {
        "model_name": "CorrexVerifier",
        "version": "1.1",
        "input_shape": [1, SEQ_LEN, IMG_SIZE, IMG_SIZE, 3],
        "output_shape": [1, N_CLASSES],
        "classes": CLASSES,
        "seq_len": SEQ_LEN,
        "img_size": IMG_SIZE,
        "backbone": "MobileNetV2",
        "clip_dim": CLIP_DIM,
        "gru_hidden": GRU_HIDDEN,
        "quantized": args.quantize,
        "normalization": {
            "mean": [0.485, 0.456, 0.406],
            "std":  [0.229, 0.224, 0.225],
        },
    }
    (out_dir / "correx_meta.json").write_text(json.dumps(meta, indent=2))

    log.info(f"Exported to {out_dir.resolve()}/")
    for f in sorted(out_dir.glob("*")):
        log.info(f"  {f.name:<40} {f.stat().st_size/1024:>8.1f} KB")


if __name__ == "__main__":
    main()
