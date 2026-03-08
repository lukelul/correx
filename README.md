# Correx — Robotic Task Verification

> **Post-execution compliance for any robot policy.**
> A VLM-powered layer that watches what a robot actually did and decides whether it succeeded — in real time, on-device, with privacy by default.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.10+](https://img.shields.io/badge/Python-3.10%2B-blue)](https://python.org)
[![Next.js 14](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org)
[![TF.js 4.22](https://img.shields.io/badge/TF.js-4.22-orange)](https://js.tensorflow.org)

---

## The Problem

Robots execute tasks but have no semantic understanding of whether the outcome was correct. A pick-and-place robot can't tell if it grabbed the wrong item, dropped the package, or left the stove on. Every robot policy is blind to its own failures.

## The Solution

Correx is a compliance verification layer that sits on top of any robot policy. An ultra-wide camera mounted to the robot runs post-execution checks using a vision-language model — classifying each task as `success`, `wrong_item`, `drop_detected`, `placement_miss`, or `grip_failure`. Every failure feeds back into a federated learning loop, making future robots smarter.

```
Robot executes task
        │
        ▼
┌───────────────────┐
│  Correx Camera    │  ← ultra-wide, mounts to any robot
│  (on-device)      │
└────────┬──────────┘
         │  video frames
         ▼
┌───────────────────┐        ┌──────────────────────┐
│  Privacy Shield   │        │  CorrexVerifier       │
│  COCO-SSD person  │──────▶ │  MobileNetV2 + GRU   │
│  pixelation       │        │  5-class classifier   │
└───────────────────┘        └──────────┬───────────┘
                                        │
                    ┌───────────────────┼───────────────────┐
                    ▼                   ▼                   ▼
             PASS / FAIL          Alert (SMS/email)   Training loop
```

---

## Features

- **GPT-4o verification** — structured PASS/FAIL reports with 4-point checks, confidence, and risk level
- **On-device model** — MobileNetV2 + GRU classifier exported to TF.js, runs entirely in the browser (no API key needed)
- **Privacy Shield** — COCO-SSD person detection with real-time pixelation before any frame leaves the device
- **Live Monitor** — simulated warehouse robot feed with failure injection, correction queue, and animated cost counter
- **Training pipeline** — download real robot datasets → GPT-4o label → CLIP+GRU train → export to TF.js
- **SMS + email alerts** — Twilio + Resend integration for real-time failure notifications
- **Phone camera sharing** — QR code to stream from any mobile device as a remote camera
- **Verification history** — all past checks persisted in localStorage with stats

---

## Quick Start

### Web App

```bash
cd robotic-task-verification
cp .env.example .env.local     # fill in your API keys
npm install
npm run dev
# → http://localhost:3000
```

The app works immediately in demo mode without any API keys. To enable GPT-4o verification, add your `OPENAI_API_KEY`.

### ML Pipeline (optional — pre-trained model included)

A trained TF.js model is already bundled at `robotic-task-verification/public/model/`. To retrain on your own data:

```bash
cd pipeline
pip install -r requirements.txt
pip install git+https://github.com/openai/CLIP.git

# Request dataset access first (both are gated on HuggingFace):
# - https://huggingface.co/datasets/droid-dataset/droid
# - https://huggingface.co/datasets/RealSourceData/RealSource-World
huggingface-cli login

export OPENAI_API_KEY=sk-...   # for GPT-4o labeling (step 2)

python 1_download.py            # download robot episodes
python 2_label.py               # label with annotations + GPT-4o
python 3_train.py --no-wandb    # train CorrexVerifier
python 5_reexport_tfjs.py       # export to TF.js

# Copy the model into the web app
cp -r pipeline/models/tfjs/* robotic-task-verification/public/model/
```

See [`pipeline/README.md`](pipeline/README.md) for full pipeline documentation.

---

## Project Structure

```
correx/
├── robotic-task-verification/   Next.js 14 web app
│   ├── app/
│   │   ├── page.tsx             Main 4-tab layout (Verify / Monitor / Training / History)
│   │   └── api/
│   │       ├── verify/          GPT-4o verification endpoint
│   │       ├── alert/           SMS + email alerts (Twilio + Resend)
│   │       └── network-info/    Local IP for QR code camera sharing
│   ├── components/
│   │   ├── CameraCapture.tsx    Live camera with QR code sharing
│   │   ├── LiveMonitor.tsx      Warehouse simulator with failure injection
│   │   ├── PrivacyShieldVideo.tsx  COCO-SSD person pixelation
│   │   ├── TrainingClips.tsx    Upload → label → export dataset
│   │   └── VerificationResult.tsx  PASS/FAIL card with checks
│   └── public/model/            Pre-trained TF.js model (MobileNetV2 + GRU)
│
├── pipeline/                    ML training pipeline
│   ├── 1_download.py            Download DROID + RealSource World datasets
│   ├── 2_label.py               Label with quality annotations + GPT-4o + synthetic corruption
│   ├── 3_train.py               Train CLIP ViT-B/16 + GRU classifier
│   ├── 4_export.py              Export to TF.js (Keras 3 — reference)
│   ├── 5_reexport_tfjs.py       Export to TF.js (tf_keras compat — use this one)
│   └── requirements.txt
│
└── correx-live-test.html        Standalone single-file live monitor (no build step)
```

---

## The Model

**CorrexVerifier** is a two-stage classifier:

1. **Feature extraction** — MobileNetV2 (ImageNet weights, frozen) + learned linear projection to 512-dim embedding, applied to each of 16 evenly-spaced frames
2. **Temporal reasoning** — GRU (hidden=256) over the frame sequence → 5-class softmax

Trained on:
- [DROID](https://droid-dataset.github.io/) — 37 real robot pick-and-place episodes
- [RealSource World](https://huggingface.co/datasets/RealSourceData/RealSource-World) — 577 episodes with quality annotations (movement_fluency, grasp_success, placement_quality)

Exported to TF.js using [tf_keras](https://github.com/keras-team/tf-keras) for browser inference (~14 MB, runs in <500ms on a laptop CPU).

**Current limitation:** The model was trained on a small dataset with significant class imbalance (~98% success). More labeled failure examples are needed for reliable failure detection — contributions welcome.

---

## Web App Tabs

### Verify
Upload any image or video. GPT-4o analyzes it against a task description and returns a structured report: verdict, confidence %, 4-point check breakdown (task completion, safety, environment state, unintended consequences), risk level, and recommendation.

### Live Monitor
Simulated warehouse robot feed with configurable failure rates. Demonstrates the full correction loop: failure detected → alert sent → correction queued → feedback added to training set. Includes latency sparkline, false negative alarm, WMS integration mode, and animated cost counter.

### Training
Upload your own robot clips, describe the task, and label them via GPT-4o or the on-device model. Export as `.jsonl` for fine-tuning. The "Run On-Device Model" button runs CorrexVerifier locally in your browser — no API key, no network request.

### History
All past verifications persisted in localStorage. Browse results, filter by verdict, and track accuracy over time.

---

## Privacy Shield

All video processing happens client-side. Before any frame is sent to the API:

1. TF.js + COCO-SSD detects people in the frame (runs in the browser)
2. Detected bounding boxes are pixelated via canvas downscale/upscale
3. Only the anonymized frame is sent to the verification endpoint

The shield is always on by default and shows a live person count.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | For Verify tab | GPT-4o vision API key |
| `RESEND_API_KEY` | For alerts | Email alerts via [Resend](https://resend.com) |
| `TWILIO_ACCOUNT_SID` | For alerts | SMS via [Twilio](https://twilio.com) |
| `TWILIO_AUTH_TOKEN` | For alerts | Twilio auth token |
| `TWILIO_FROM_NUMBER` | For alerts | Your Twilio phone number |

Copy `.env.example` → `.env.local` and fill in the values. The app works without any keys in demo mode.

---

## Contributing

Contributions are very welcome — especially:

- **More labeled failure data** — the biggest bottleneck is failure examples in the training set
- **Better backbone** — replace MobileNetV2 with EfficientNet or a distilled ViT for higher accuracy
- **Edge deployment** — quantization, WASM backend, or ONNX export for running on actual robot hardware
- **More failure classes** — spill detection, wrong placement zone, collision, etc.
- **Real-time streaming** — WebRTC pipeline from robot camera to verification layer

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for guidelines.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Web app | Next.js 14 (App Router), TypeScript, React 18 |
| Styling | Tailwind CSS 3.4, Framer Motion |
| Verification | GPT-4o (OpenAI) via REST |
| On-device model | TF.js 4.22 (CDN), MobileNetV2 + GRU |
| Privacy Shield | TF.js + COCO-SSD (CDN) |
| ML training | PyTorch 2.x, CLIP ViT-B/16, HuggingFace datasets |
| Alerts | Resend (email), Twilio (SMS) |

---

## License

MIT — see [LICENSE](LICENSE).

Built with ❤️ for the open robotics community.
