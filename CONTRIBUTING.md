# Contributing to Correx

Thanks for your interest! Correx is actively looking for contributions in a few key areas.

## Where Help Is Most Needed

### 1. Labeled failure data
The biggest bottleneck is real failure examples. If you have robot footage with known failures (drops, wrong items, placement misses), labeling it and contributing to the dataset would have the highest impact. See `pipeline/2_label.py` for the expected format.

### 2. Better on-device backbone
The current browser model uses MobileNetV2 as a visual feature extractor. A distilled ViT or EfficientNet-Lite would likely improve accuracy without increasing size significantly.

### 3. New failure classes
The current 5 classes (`success`, `wrong_item`, `drop_detected`, `placement_miss`, `grip_failure`) cover pick-and-place. Adding classes for other task types (cooking, assembly, logistics) would broaden applicability.

### 4. Edge deployment
Getting CorrexVerifier running natively on robot hardware (Raspberry Pi, Jetson Nano) via ONNX or TFLite. The pipeline exports a PyTorch checkpoint — an ONNX export step would be straightforward.

## Getting Started

```bash
git clone https://github.com/your-org/correx
cd correx

# Web app
cd robotic-task-verification
cp .env.example .env.local
npm install && npm run dev

# ML pipeline
cd ../pipeline
pip install -r requirements.txt
pip install git+https://github.com/openai/CLIP.git
```

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- For ML changes, include before/after metrics (val loss, per-class FNR)
- For UI changes, include a screenshot
- Run `npm run lint` before submitting

## Reporting Issues

Open a GitHub issue with:
- What you were trying to do
- What happened
- Your OS, Python version, and Node version

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
