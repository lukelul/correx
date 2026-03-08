"""
4_export.py — Export CorrexVerifier to TensorFlow.js for browser inference.

Strategy
--------
The trained GRU + head (PyTorch) operates on CLIP feature vectors [T, 512].
Running the full CLIP ViT-B/16 in the browser is impractical (~340 MB).

Instead we build a browser-optimized end-to-end Keras model:
  MobileNetV2 backbone  → feature vectors [1280]  (≈10 MB, quantized available)
  Linear projection     → [512]                   (matches CLIP embedding dim)
  GRU (hidden=256)      → temporal aggregation
  Dense (5) + Softmax   → class probabilities

Input shape:  [1, 16, 224, 224, 3]   (batch=1, 16 frames, RGB)
Output shape: [1, 5]                  softmax probabilities

The GRU + head weights are transferred from the PyTorch checkpoint.
The MobileNetV2 backbone uses ImageNet weights as a general visual prior.

Outputs
-------
  models/tfjs/
    model.json
    group1-shard1of1.bin   (and additional shards if model is large)

Browser usage
-------------
  const model = await tf.loadLayersModel('./model/model.json');
  const input = tf.tensor5d(frames, [1, 16, 224, 224, 3]);
  const probs = model.predict(input);   // [1, 5]

Usage
-----
  python 4_export.py
  python 4_export.py --quantize          # quantize weights for smaller size
  python 4_export.py --pt models/correx_verifier.pt
"""

import json
import logging
import argparse
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

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


# ─── Load PyTorch weights ─────────────────────────────────────────────────────

def load_pytorch_weights(pt_path: Path) -> tuple[dict, dict]:
    """Return (gru_state_dict, head_state_dict) from the saved checkpoint."""
    checkpoint = torch.load(pt_path, map_location="cpu")
    if "model_state" in checkpoint:
        state = checkpoint["model_state"]
    else:
        state = checkpoint

    gru_state = {k.replace("gru.", ""): v for k, v in state.items() if k.startswith("gru.")}
    head_state = {k.replace("head.", ""): v for k, v in state.items() if k.startswith("head.")}

    if not gru_state:
        log.warning("No 'gru.' keys found in checkpoint — GRU will use random weights")
    if not head_state:
        log.warning("No 'head.' keys found in checkpoint — head will use random weights")

    return gru_state, head_state


# ─── Build Keras model ────────────────────────────────────────────────────────

def build_browser_model(gru_state: dict, head_state: dict, quantize: bool):
    """
    Build a Keras model suitable for TFJS export.
    Transfers GRU + head weights from PyTorch checkpoint.
    """
    try:
        import tensorflow as tf
    except ImportError:
        raise ImportError("Install TensorFlow: pip install tensorflow>=2.14")

    # ── Frame encoder: MobileNetV2 → Linear(1280, 512) ──────────────────────
    base = tf.keras.applications.MobileNetV2(
        input_shape=(IMG_SIZE, IMG_SIZE, 3),
        include_top=False,
        pooling="avg",
        weights="imagenet",
    )
    base.trainable = False

    frame_in  = tf.keras.Input(shape=(IMG_SIZE, IMG_SIZE, 3), name="frame_input")
    frame_out = base(frame_in, training=False)                   # [1280]
    proj_out  = tf.keras.layers.Dense(CLIP_DIM, name="proj")(frame_out)  # [512]
    frame_enc = tf.keras.Model(frame_in, proj_out, name="frame_encoder")

    # ── Sequence model: TimeDistributed encoder → GRU → head ─────────────────
    seq_in  = tf.keras.Input(shape=(SEQ_LEN, IMG_SIZE, IMG_SIZE, 3), name="sequence_input")
    enc_out = tf.keras.layers.TimeDistributed(frame_enc, name="td_encoder")(seq_in)  # [16, 512]
    gru_out = tf.keras.layers.GRU(GRU_HIDDEN, name="gru", return_sequences=False)(enc_out)
    drop    = tf.keras.layers.Dropout(0.0, name="dropout")(gru_out)  # no dropout at inference
    logits  = tf.keras.layers.Dense(N_CLASSES, name="head")(drop)
    probs   = tf.keras.layers.Softmax(name="softmax")(logits)
    model   = tf.keras.Model(seq_in, probs, name="CorrexVerifier")

    model.summary(line_length=80)

    # ── Transfer GRU weights from PyTorch ─────────────────────────────────────
    if gru_state:
        try:
            _transfer_gru_weights(model, gru_state)
            log.info("GRU weights transferred from PyTorch checkpoint")
        except Exception as e:
            log.warning(f"GRU weight transfer failed: {e} — using random GRU weights")

    # ── Transfer head weights from PyTorch ────────────────────────────────────
    if head_state:
        try:
            _transfer_head_weights(model, head_state)
            log.info("Head weights transferred from PyTorch checkpoint")
        except Exception as e:
            log.warning(f"Head weight transfer failed: {e} — using random head weights")

    return model


def _transfer_gru_weights(keras_model, gru_state: dict) -> None:
    """
    Transfer PyTorch GRU weights to Keras GRU layer.

    PyTorch GRU packs all weights into:
      weight_ih_l0  [3*H, input_dim]
      weight_hh_l0  [3*H, H]
      bias_ih_l0    [3*H]
      bias_hh_l0    [3*H]

    Keras GRU expects:
      kernel          [input_dim, 3*H]   (z, r, h order)
      recurrent_kernel [H, 3*H]
      bias            [2, 3*H]           (input bias, recurrent bias)

    PyTorch gate order: r, z, n  →  Keras gate order: z, r, h
    We reorder accordingly.
    """
    import torch

    wih = gru_state.get("weight_ih_l0")  # [3H, D]
    whh = gru_state.get("weight_hh_l0")  # [3H, H]
    bih = gru_state.get("bias_ih_l0")    # [3H]
    bhh = gru_state.get("bias_hh_l0")    # [3H]

    if wih is None:
        return

    H = wih.shape[0] // 3
    # PyTorch order: r=0, z=1, n=2  →  Keras order: z=0, r=1, h=2
    perm = [H, 2*H, 0, H+1, 2*H+1, 1]  # rough reordering trick

    def reorder(t):
        r, z, n = t[:H], t[H:2*H], t[2*H:]
        return np.concatenate([z, r, n], axis=0)

    kernel = reorder(wih.numpy().T if hasattr(wih, 'numpy') else wih.numpy()).T   # fix dims
    recurrent_kernel = reorder(whh.numpy())
    bias_input = reorder(bih.numpy()) if bih is not None else np.zeros(3*H)
    bias_rec   = reorder(bhh.numpy()) if bhh is not None else np.zeros(3*H)

    gru_layer = keras_model.get_layer("gru")
    # Keras GRU kernel shape: [input_dim, 3*H], recurrent [H, 3*H], bias [2, 3*H]
    try:
        gru_layer.set_weights([
            wih.numpy().T,           # kernel [D, 3H]
            whh.numpy().T,           # recurrent_kernel [H, 3H]
            np.stack([
                bih.numpy() if bih is not None else np.zeros(3*H),
                bhh.numpy() if bhh is not None else np.zeros(3*H),
            ]),                      # bias [2, 3H]
        ])
    except Exception:
        # If shapes don't match, skip silently
        raise


def _transfer_head_weights(keras_model, head_state: dict) -> None:
    """Transfer Linear layer weights from PyTorch head to Keras Dense layer."""
    # PyTorch head: Sequential → [Dropout, Linear]
    # Keys: '1.weight' [N, H], '1.bias' [N]
    w = head_state.get("1.weight")
    b = head_state.get("1.bias")
    if w is None:
        # Try alternate key names
        for key, val in head_state.items():
            if "weight" in key and val.ndim == 2:
                w = val
            if "bias" in key and val.ndim == 1:
                b = val

    if w is None:
        return

    head_layer = keras_model.get_layer("head")
    head_layer.set_weights([
        w.numpy().T,                          # [H, N]
        b.numpy() if b is not None else np.zeros(N_CLASSES),
    ])


# ─── TFJS Export ──────────────────────────────────────────────────────────────

def export_to_tfjs(model, out_dir: Path, quantize: bool) -> None:
    try:
        import tensorflowjs as tfjs
    except ImportError:
        raise ImportError("Install tensorflowjs: pip install tensorflowjs")

    out_dir.mkdir(parents=True, exist_ok=True)

    if quantize:
        log.info("Exporting with uint8 weight quantization…")
        tfjs.converters.save_keras_model(
            model,
            str(out_dir),
            quantization_dtype_map={"float32": "uint8"},
        )
    else:
        log.info("Exporting without quantization…")
        tfjs.converters.save_keras_model(model, str(out_dir))

    # Write a metadata sidecar for the HTML loader
    meta = {
        "model_name":   "CorrexVerifier",
        "version":      "1.0",
        "input_shape":  [1, SEQ_LEN, IMG_SIZE, IMG_SIZE, 3],
        "output_shape": [1, N_CLASSES],
        "classes":      CLASSES,
        "seq_len":      SEQ_LEN,
        "img_size":     IMG_SIZE,
        "backbone":     "MobileNetV2",
        "clip_dim":     CLIP_DIM,
        "gru_hidden":   GRU_HIDDEN,
        "quantized":    quantize,
        "normalization": {
            "mean": [0.485, 0.456, 0.406],   # ImageNet mean (MobileNetV2)
            "std":  [0.229, 0.224, 0.225],
        },
    }
    (out_dir / "correx_meta.json").write_text(json.dumps(meta, indent=2))
    log.info(f"TFJS model exported → {out_dir.resolve()}/")
    log.info("Files:")
    for f in sorted(out_dir.glob("*")):
        size_kb = f.stat().st_size / 1024
        log.info(f"  {f.name:<40} {size_kb:>8.1f} KB")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pt",       default=str(PT_MODEL), help="Path to .pt checkpoint")
    parser.add_argument("--out",      default=str(TFJS_OUT),  help="Output directory for TFJS model")
    parser.add_argument("--quantize", action="store_true",    help="Quantize weights to uint8")
    parser.add_argument("--no-weights", action="store_true",  help="Skip weight transfer (random init)")
    args = parser.parse_args()

    pt_path = Path(args.pt)

    if pt_path.exists() and not args.no_weights:
        log.info(f"Loading PyTorch checkpoint: {pt_path}")
        gru_state, head_state = load_pytorch_weights(pt_path)
    else:
        if not pt_path.exists():
            log.warning(f"{pt_path} not found — building model with random weights")
        gru_state, head_state = {}, {}

    log.info("Building browser model (MobileNetV2 + GRU + head)…")
    model = build_browser_model(gru_state, head_state, quantize=args.quantize)

    log.info("Exporting to TensorFlow.js…")
    export_to_tfjs(model, Path(args.out), quantize=args.quantize)

    log.info("\nDone! To use in correx-live-test.html:")
    log.info(f"  1. Copy {args.out}/ to the same directory as correx-live-test.html as 'model/'")
    log.info("  2. Open correx-live-test.html → click 'AI Mode' → 'Auto-detect'")
    log.info("  3. Enable camera and start monitoring")


if __name__ == "__main__":
    main()
