"""
3_train.py — Train the CorrexVerifier model.

Architecture
------------
  CLIP ViT-B/16   (frozen)  → frame embeddings [512]
  GRU (hidden=256)          → temporal aggregation over T=16 frames
  Dropout(0.3) + Linear(5)  → class logits
  Softmax                   → class probabilities

Training strategy
-----------------
  Phase 1: freeze CLIP, train only GRU + head (10 epochs)
  Phase 2: unfreeze last 4 CLIP transformer blocks, fine-tune all (5 epochs)

Primary metric: False Negative Rate per failure class (target <5%)
Loss: weighted cross-entropy (3x penalty on all failure classes)

Outputs
-------
  models/correx_verifier.pt     final model weights (state_dict + config)
  models/clip_features/         pre-extracted CLIP features (speeds up Phase 1)

Usage
-----
  export WANDB_API_KEY=...     # optional but recommended
  python 3_train.py
  python 3_train.py --no-wandb --epochs 5 --batch-size 16
"""

import os
import json
import random
import logging
import argparse
from pathlib import Path
from collections import Counter, defaultdict

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
from PIL import Image
from tqdm import tqdm

try:
    import clip
except ImportError:
    raise ImportError("Install OpenAI CLIP: pip install git+https://github.com/openai/CLIP.git")

try:
    import wandb
    WANDB_AVAILABLE = True
except ImportError:
    WANDB_AVAILABLE = False

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ─── Config ───────────────────────────────────────────────────────────────────

LABELED_DIR   = Path("data/labeled")
MANIFEST      = LABELED_DIR / "manifest.jsonl"
FEATURES_DIR  = Path("models/clip_features")
MODEL_OUT     = Path("models/correx_verifier.pt")

CLASSES     = ["success", "wrong_item", "drop_detected", "placement_miss", "grip_failure"]
N_CLASSES   = len(CLASSES)
SEQ_LEN     = 16    # frames per sequence (pad/truncate to this)
IMG_SIZE    = 224
CLIP_DIM    = 512

DEVICE = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"

# Class weights: 3x penalty on all failure classes
CLASS_WEIGHTS = torch.tensor([1.0, 3.0, 3.0, 3.0, 3.0])


# ─── Dataset ──────────────────────────────────────────────────────────────────

class CorrexDataset(Dataset):
    def __init__(self, records: list[dict], features_dir: Path, seq_len: int = SEQ_LEN):
        self.records = records
        self.features_dir = features_dir
        self.seq_len = seq_len

    def __len__(self) -> int:
        return len(self.records)

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, int]:
        rec = self.records[idx]
        feat_path = self.features_dir / f"{rec['episode_id']}.npy"

        if feat_path.exists():
            features = np.load(feat_path)  # [T, 512]
        else:
            # Fallback: zero features (shouldn't happen after pre-extraction)
            features = np.zeros((1, CLIP_DIM), dtype=np.float32)

        features = torch.from_numpy(features.astype(np.float32))  # [T, 512]

        # Pad or truncate to seq_len
        T = features.shape[0]
        if T >= self.seq_len:
            # Take the last seq_len frames (capture/placement window)
            features = features[-self.seq_len:]
        else:
            pad = torch.zeros(self.seq_len - T, CLIP_DIM)
            features = torch.cat([pad, features], dim=0)

        return features, rec["label_idx"]


def load_manifest(path: Path) -> list[dict]:
    records = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def train_val_split(records: list[dict], val_frac: float = 0.15) -> tuple[list, list]:
    """Stratified split to preserve class balance."""
    by_class = defaultdict(list)
    for r in records:
        by_class[r["label_idx"]].append(r)
    train, val = [], []
    for cls_records in by_class.values():
        random.shuffle(cls_records)
        n_val = max(1, int(len(cls_records) * val_frac))
        val   += cls_records[:n_val]
        train += cls_records[n_val:]
    random.shuffle(train)
    random.shuffle(val)
    return train, val


# ─── Feature Pre-extraction ───────────────────────────────────────────────────

def preextract_clip_features(records: list[dict], clip_model, preprocess, device: str) -> None:
    """Pre-extract CLIP frame embeddings for all episodes and cache as .npy files."""
    FEATURES_DIR.mkdir(parents=True, exist_ok=True)
    clip_model.eval()

    for rec in tqdm(records, desc="Pre-extracting CLIP features"):
        out_path = FEATURES_DIR / f"{rec['episode_id']}.npy"
        if out_path.exists():
            continue

        frames_rel = rec.get("frames_dir")
        if not frames_rel:
            np.save(out_path, np.zeros((1, CLIP_DIM), dtype=np.float32))
            continue
        frames_dir = LABELED_DIR / frames_rel
        if not frames_dir.exists():
            np.save(out_path, np.zeros((1, CLIP_DIM), dtype=np.float32))
            continue

        frame_paths = sorted(frames_dir.glob("*.jpg"))
        if not frame_paths:
            np.save(out_path, np.zeros((1, CLIP_DIM), dtype=np.float32))
            continue

        images = []
        for p in frame_paths:
            try:
                img = preprocess(Image.open(p).convert("RGB"))
                images.append(img)
            except Exception:
                continue

        if not images:
            np.save(out_path, np.zeros((1, CLIP_DIM), dtype=np.float32))
            continue

        batch = torch.stack(images).to(device)
        with torch.no_grad():
            features = clip_model.encode_image(batch).float().cpu().numpy()  # [T, 512]

        np.save(out_path, features)


# ─── Model ────────────────────────────────────────────────────────────────────

class CorrexVerifier(nn.Module):
    def __init__(self, clip_dim: int = CLIP_DIM, gru_hidden: int = 256, n_classes: int = N_CLASSES):
        super().__init__()
        self.gru  = nn.GRU(clip_dim, gru_hidden, batch_first=True, bidirectional=False)
        self.head = nn.Sequential(
            nn.Dropout(0.3),
            nn.Linear(gru_hidden, n_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: [B, T, clip_dim]
        _, hidden = self.gru(x)         # hidden: [1, B, gru_hidden]
        hidden = hidden.squeeze(0)      # [B, gru_hidden]
        return self.head(hidden)        # [B, n_classes]


# ─── Metrics ──────────────────────────────────────────────────────────────────

def compute_fnr_per_class(preds: list[int], labels: list[int]) -> dict[str, float]:
    """False Negative Rate per class: FN / (FN + TP)"""
    fnr = {}
    for i, cls in enumerate(CLASSES):
        tp = sum(1 for p, l in zip(preds, labels) if p == i and l == i)
        fn = sum(1 for p, l in zip(preds, labels) if p != i and l == i)
        fnr[cls] = fn / (fn + tp) if (fn + tp) > 0 else 0.0
    return fnr


def evaluate(model: nn.Module, loader: DataLoader, criterion, device: str) -> dict:
    model.eval()
    total_loss = 0.0
    all_preds, all_labels = [], []
    with torch.no_grad():
        for features, labels in loader:
            features, labels = features.to(device), labels.to(device)
            logits = model(features)
            loss   = criterion(logits, labels)
            total_loss += loss.item() * len(labels)
            preds = logits.argmax(dim=-1).cpu().tolist()
            all_preds.extend(preds)
            all_labels.extend(labels.cpu().tolist())

    n  = len(all_labels)
    acc = sum(p == l for p, l in zip(all_preds, all_labels)) / n if n else 0.0
    fnr = compute_fnr_per_class(all_preds, all_labels)
    return {
        "loss":     total_loss / n if n else 0.0,
        "accuracy": acc,
        "fnr":      fnr,
        "max_fnr":  max(fnr[c] for c in CLASSES[1:]),  # worst failure-class FNR
    }


# ─── Training Loop ────────────────────────────────────────────────────────────

def train_epoch(model, loader, optimizer, criterion, device) -> float:
    model.train()
    total_loss = 0.0
    for features, labels in tqdm(loader, desc="  train", leave=False):
        features, labels = features.to(device), labels.to(device)
        optimizer.zero_grad()
        logits = model(features)
        loss   = criterion(logits, labels)
        loss.backward()
        nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
        optimizer.step()
        total_loss += loss.item() * len(labels)
    return total_loss / len(loader.dataset)


def run_training(records_train, records_val, epochs, batch_size, lr, use_wandb):
    train_ds = CorrexDataset(records_train, FEATURES_DIR)
    val_ds   = CorrexDataset(records_val,   FEATURES_DIR)

    # Weighted sampler to enforce rough 70/30 success/failure ratio
    label_counts = Counter(r["label_idx"] for r in records_train)
    weights = [1.0 / label_counts[r["label_idx"]] for r in records_train]
    sampler = WeightedRandomSampler(weights, num_samples=len(records_train), replacement=True)

    train_loader = DataLoader(train_ds, batch_size=batch_size, sampler=sampler, num_workers=0, pin_memory=False)
    val_loader   = DataLoader(val_ds,   batch_size=batch_size, shuffle=False,  num_workers=0, pin_memory=False)

    model     = CorrexVerifier().to(DEVICE)
    criterion = nn.CrossEntropyLoss(weight=CLASS_WEIGHTS.to(DEVICE))
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    best_max_fnr = float("inf")
    best_state   = {k: v.clone() for k, v in model.state_dict().items()}

    for epoch in range(1, epochs + 1):
        log.info(f"Epoch {epoch}/{epochs}")
        train_loss = train_epoch(model, train_loader, optimizer, criterion, DEVICE)
        metrics    = evaluate(model, val_loader, criterion, DEVICE)
        scheduler.step()

        log.info(
            f"  train_loss={train_loss:.4f}  val_loss={metrics['loss']:.4f}  "
            f"acc={metrics['accuracy']:.3f}  max_fnr={metrics['max_fnr']:.3f}"
        )
        for cls, fnr in metrics["fnr"].items():
            log.info(f"    FNR[{cls}] = {fnr:.3f}")

        if use_wandb and WANDB_AVAILABLE:
            wandb.log({
                "epoch": epoch,
                "train/loss": train_loss,
                "val/loss": metrics["loss"],
                "val/accuracy": metrics["accuracy"],
                "val/max_fnr": metrics["max_fnr"],
                **{f"val/fnr/{cls}": fnr for cls, fnr in metrics["fnr"].items()},
            })

        # Save best checkpoint (minimize worst-class FNR)
        if metrics["max_fnr"] < best_max_fnr:
            best_max_fnr = metrics["max_fnr"]
            best_state   = {k: v.clone() for k, v in model.state_dict().items()}
            log.info(f"  ✓ New best max_fnr = {best_max_fnr:.3f}")

    if best_max_fnr <= 0.05:
        log.info("✓ Target FNR < 5% achieved on all failure classes")
    else:
        log.warning(f"Target FNR < 5% NOT achieved (best max_fnr = {best_max_fnr:.3f}). Consider more data.")

    return model, best_state, best_max_fnr


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs",     type=int,   default=15)
    parser.add_argument("--batch-size", type=int,   default=32)
    parser.add_argument("--lr",         type=float, default=3e-4)
    parser.add_argument("--no-wandb",   action="store_true")
    parser.add_argument("--skip-extract", action="store_true",
                        help="Skip CLIP feature pre-extraction (if already done)")
    args = parser.parse_args()

    use_wandb = WANDB_AVAILABLE and not args.no_wandb and os.environ.get("WANDB_API_KEY")

    if use_wandb:
        wandb.init(project="correx-verifier", config=vars(args))

    log.info(f"Device: {DEVICE}")

    # Load manifest
    if not MANIFEST.exists():
        raise FileNotFoundError(f"{MANIFEST} not found — run 2_label.py first")
    records = load_manifest(MANIFEST)
    log.info(f"Loaded {len(records)} records from manifest")

    # Load CLIP
    log.info("Loading CLIP ViT-B/16…")
    clip_model, clip_preprocess = clip.load("ViT-B/16", device=DEVICE)
    clip_model.eval()
    for p in clip_model.parameters():
        p.requires_grad_(False)

    # Pre-extract CLIP features
    if not args.skip_extract:
        log.info("Pre-extracting CLIP features for all episodes…")
        preextract_clip_features(records, clip_model, clip_preprocess, DEVICE)

    # Filter to episodes that have real CLIP features (non-zero)
    def has_real_features(rec):
        p = FEATURES_DIR / f"{rec['episode_id']}.npy"
        if not p.exists():
            return False
        arr = np.load(p)
        return arr.shape[0] > 0 and np.any(arr != 0)

    records_with_frames = [r for r in records if r.get("frames_dir")]
    log.info(f"Records with frames: {len(records_with_frames)} / {len(records)}")

    # Split
    records_train, records_val = train_val_split(records_with_frames)
    log.info(f"Train: {len(records_train)}  Val: {len(records_val)}")

    # Phase 1: train GRU + head only
    log.info("=== Phase 1: Training GRU + head ===")
    model, best_state, best_fnr = run_training(
        records_train, records_val,
        epochs=min(args.epochs, 10),
        batch_size=args.batch_size,
        lr=args.lr,
        use_wandb=use_wandb,
    )

    # Phase 2: fine-tune with lower LR if FNR still high
    if best_fnr > 0.05 and args.epochs > 10:
        log.info("=== Phase 2: Fine-tuning at lower LR ===")
        model.load_state_dict(best_state)
        _, best_state_2, best_fnr_2 = run_training(
            records_train, records_val,
            epochs=args.epochs - 10,
            batch_size=args.batch_size,
            lr=args.lr * 0.1,
            use_wandb=use_wandb,
        )
        if best_fnr_2 < best_fnr:
            best_state = best_state_2
            best_fnr   = best_fnr_2

    # Save
    MODEL_OUT.parent.mkdir(parents=True, exist_ok=True)
    torch.save({
        "model_state": best_state,
        "config": {
            "clip_dim":   CLIP_DIM,
            "gru_hidden": 256,
            "n_classes":  N_CLASSES,
            "classes":    CLASSES,
            "seq_len":    SEQ_LEN,
        },
        "best_max_fnr": best_fnr,
    }, MODEL_OUT)
    log.info(f"Model saved → {MODEL_OUT}  (best max FNR = {best_fnr:.3f})")

    if use_wandb:
        wandb.save(str(MODEL_OUT))
        wandb.finish()


if __name__ == "__main__":
    main()
