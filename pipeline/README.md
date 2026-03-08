# Correx ML Pipeline

Four-step pipeline that downloads real robotics datasets, builds a labeled verification dataset, trains CorrexVerifier, and exports it for browser inference in `correx-live-test.html`.

---

## Prerequisites

```bash
# Python 3.10+
pip install -r requirements.txt

# CLIP (not on PyPI)
pip install git+https://github.com/openai/CLIP.git

# HuggingFace login (DROID and RealSource are gated — request access first)
huggingface-cli login
# or: export HF_TOKEN=hf_...

# API keys
export OPENAI_API_KEY=sk-...       # for Step 2 (GPT-4o labeling)
export WANDB_API_KEY=...           # for Step 3 (training logs, optional)
```

**Dataset access** — both datasets require approval:
- DROID: https://huggingface.co/datasets/droid-dataset/droid
- RealSource World: https://huggingface.co/datasets/RealSourceData/RealSource-World

---

## Step 1 — Download

```bash
python 1_download.py
```

Downloads 500 pick-and-place episodes from DROID (exterior camera only) and all RealSource World episodes that have quality annotations.

**Options**
```
--droid-only          Download only DROID
--realsource-only     Download only RealSource
--droid-limit N       Max DROID episodes (default: 500)
```

**Output**
```
data/raw/
  droid/
    ep_00000/
      frames/          frame_0000.jpg … frame_0007.jpg  (8 frames)
      meta.json        {task, camera, n_frames, …}
    ep_00001/ …
    summary.json
  realsource/
    ep_00000/
      frames/          frame_0000.jpg … frame_0015.jpg  (16 frames)
      meta.json
      quality.json     {movement_fluency, grasp_success, placement_quality}
    summary.json
```

**Time:** ~2–6 hours depending on connection speed and dataset sizes.

---

## Step 2 — Label

```bash
python 2_label.py
```

**RealSource** episodes: quality annotations are mapped directly to Correx classes:

| Quality annotation fail | Correx class    |
|------------------------|-----------------|
| grasp_success = false  | grip_failure    |
| placement_quality = false | placement_miss |
| movement_fluency = false | drop_detected  |
| all pass               | success         |

**DROID** episodes: sent to GPT-4o Vision in 8-frame sequences. Each response is parsed to one of the 5 Correx classes.

**Synthetic corruption:** 30% of DROID success episodes are corrupted to generate failure examples:
- `drop_detected` — bottom half of final frame blurred
- `placement_miss` — final frame shifted 15% horizontally
- `grip_failure` — final frame replaced with previous (grasp phase truncated)
- `wrong_item` — final frame color-shifted green

**Options**
```
--skip-gpt      Skip GPT-4o labeling (use 'success' for all DROID)
--no-corrupt    Skip synthetic corruption step
```

**Output**
```
data/labeled/
  manifest.jsonl     One JSON record per episode (label, class index, frames path)
  stats.json         Label counts and class balance
  ep_*/frames/       Symlinked or copied frames
```

**Expected stats** (with defaults)
```
success          ~450   (48%)
wrong_item       ~90    (10%)
drop_detected    ~120   (13%)
placement_miss   ~155   (17%)
grip_failure     ~110   (12%)
TOTAL            ~925
```

If any failure class falls below 200 examples, the script will warn you. In that case: increase `--droid-limit` in Step 1 or increase `CORRUPT_RATE` in `2_label.py`.

**Cost:** GPT-4o at low detail, 8 images per episode, 500 episodes ≈ ~$4–8.

---

## Step 3 — Train

```bash
python 3_train.py
```

Trains CorrexVerifier:
- **Backbone:** CLIP ViT-B/16 (frozen) — pre-extracts frame embeddings to `models/clip_features/` on first run
- **GRU:** hidden=256, over 16-frame sequences
- **Head:** Dropout(0.3) + Linear(5)
- **Loss:** CrossEntropyLoss with 3× weight on all failure classes
- **Metric:** False Negative Rate per class — target <5% before considering model ready

**Options**
```
--epochs N         Total training epochs (default: 15)
--batch-size N     Batch size (default: 32)
--lr FLOAT         Learning rate (default: 3e-4)
--no-wandb         Disable W&B logging
--skip-extract     Skip CLIP feature pre-extraction (if already done)
```

**Output**
```
models/
  clip_features/       Cached CLIP embeddings (.npy, one per episode)
  correx_verifier.pt   Best checkpoint (saved when val FNR improves)
```

**Time:** ~30 min on GPU (feature extraction), ~15 min training.

**W&B dashboard** will show per-class FNR curves. The model is considered ready when `max_fnr < 0.05` across all failure classes.

---

## Step 4 — Export

```bash
python 4_export.py
```

Builds a browser-optimized Keras model and exports it to TFJS format.

**Architecture note:** The full CLIP ViT-B/16 backbone (~340 MB) is replaced with MobileNetV2 (~10 MB) for browser deployment. The GRU + head weights are transferred from the PyTorch checkpoint. MobileNetV2 uses ImageNet weights as a visual prior; for best accuracy, fine-tune the projection layer on your labeled data.

**Options**
```
--pt PATH         Path to .pt checkpoint (default: models/correx_verifier.pt)
--out PATH        Output directory (default: models/tfjs)
--quantize        Quantize weights to uint8 (~4× smaller, slight accuracy drop)
--no-weights      Export model structure only (random weights, for testing)
```

**Output**
```
models/tfjs/
  model.json           TFJS model topology
  group1-shard*.bin    Weight shards
  correx_meta.json     Input/output shapes, class names, normalization params
```

**Typical file size:** ~12 MB unquantized, ~4 MB quantized.

---

## Step 5 — Integrate with correx-live-test.html

```bash
# Copy TFJS model to HTML directory
cp -r models/tfjs ../model

# Then open correx-live-test.html in a browser (must be served, not file://)
cd ..
python -m http.server 8080
# Open http://localhost:8080/correx-live-test.html
```

1. Click **AI Mode**
2. Click **Auto-detect** — loads `./model/model.json` automatically
3. Click **Enable Camera**
4. The system runs inference every 2 seconds and pipes results into the live event log

If the model fails to load, a yellow banner appears and the system falls back to Simulation mode automatically.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `gated dataset` 403 error | Request access on HuggingFace, then `huggingface-cli login` |
| GPT-4o returns non-JSON | Usually a rate limit — the script retries 3× with backoff |
| FNR stays above 5% | Add more data (increase `--droid-limit`), increase `CORRUPT_RATE`, or train longer |
| TFJS model too large | Run `python 4_export.py --quantize` |
| `No module named 'clip'` | `pip install git+https://github.com/openai/CLIP.git` |
| TF/PyTorch version conflict | Use a dedicated venv: `python -m venv correx-env && source correx-env/bin/activate` |

---

## File Structure

```
pipeline/
  1_download.py         Download DROID + RealSource
  2_label.py            Label with annotations + GPT-4o + synthetic corruption
  3_train.py            Train CorrexVerifier (CLIP + GRU + head)
  4_export.py           Export to TensorFlow.js
  requirements.txt
  README.md

data/
  raw/                  Raw downloaded episodes
  labeled/              Labeled dataset + manifest.jsonl

models/
  clip_features/        Cached CLIP embeddings
  correx_verifier.pt    Trained PyTorch checkpoint
  tfjs/                 TFJS export (copy to ../model/ for HTML)

../correx-live-test.html   Single-file live monitor with Sim + AI mode
../model/                  TFJS model (served alongside HTML)
```
