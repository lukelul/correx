"""
2_label.py — Build a labeled dataset for CorrexVerifier training.

Sources
-------
- data/raw/realsource/   → map quality annotations directly to Correx classes
- data/raw/droid/        → auto-label with GPT-4o Vision; corrupt 30% of successes

Correx Classes
--------------
  0  success
  1  wrong_item
  2  drop_detected
  3  placement_miss
  4  grip_failure

Output
------
  data/labeled/
    manifest.jsonl       one JSON object per episode, one line each
    {ep_id}/frames/      symlinked / copied from raw
  data/labeled/stats.json   label counts and class balance summary

Usage
-----
  export OPENAI_API_KEY=sk-...
  python 2_label.py
  python 2_label.py --skip-gpt       # skip GPT labeling (use manifest only)
  python 2_label.py --no-corrupt     # skip synthetic corruption step
"""

import os
import json
import base64
import random
import shutil
import logging
import argparse
import time
from pathlib import Path
from collections import Counter
from typing import Optional

import numpy as np
from PIL import Image, ImageFilter
from tqdm import tqdm
from openai import OpenAI

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

RAW_DIR     = Path("data/raw")
OUT_DIR     = Path("data/labeled")
MANIFEST    = OUT_DIR / "manifest.jsonl"

CLASSES = ["success", "wrong_item", "drop_detected", "placement_miss", "grip_failure"]
CLASS_IDX = {c: i for i, c in enumerate(CLASSES)}

CORRUPT_RATE = 0.30      # fraction of DROID successes to synthetically corrupt
GPT_MODEL    = "gpt-4o"
GPT_FRAMES   = 8         # frames to send per labeling call
GPT_RETRY    = 3         # retries on API error

# ─── RealSource Annotation Mapping ───────────────────────────────────────────

def map_realsource_quality(quality: dict) -> str:
    """
    Map RealSource quality annotations to a Correx class.

    quality keys: movement_fluency, grasp_success, placement_quality
    Each value is True/False or a pass/fail string.
    """
    def is_pass(v):
        if v is None:
            return True   # absent → assume pass
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            return v.lower() in ("pass", "success", "true", "1", "ok", "good")
        if isinstance(v, (int, float)):
            return v >= 0.5
        return True

    fluency   = is_pass(quality.get("movement_fluency"))
    grasp     = is_pass(quality.get("grasp_success"))
    placement = is_pass(quality.get("placement_quality"))

    if fluency and grasp and placement:
        return "success"
    if not grasp:
        return "grip_failure"
    if not placement:
        return "placement_miss"
    # Fluency failure with no grasp/placement issue → treat as drop
    return "drop_detected"


# ─── GPT-4o Labeling ──────────────────────────────────────────────────────────

GPT_PROMPT = """Analyze this robot manipulation sequence (frames in chronological order).

Determine the outcome:
1. Did the task succeed completely?
2. If not, classify the primary failure:
   - wrong_item: robot picked the wrong object
   - drop_detected: robot dropped the item during transit
   - placement_miss: item placed in wrong location or misaligned
   - grip_failure: robot failed to grasp the item securely

Respond with ONLY valid JSON, no markdown:
{"label": "<success|wrong_item|drop_detected|placement_miss|grip_failure>", "confidence": <0-100>, "reasoning": "<one sentence>"}"""


def encode_image(path: Path) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def label_with_gpt(frame_paths: list[Path], client: OpenAI) -> Optional[dict]:
    """Send up to GPT_FRAMES frames to GPT-4o and parse the label response."""
    # Subsample to GPT_FRAMES evenly
    n = len(frame_paths)
    if n > GPT_FRAMES:
        step = n / GPT_FRAMES
        frame_paths = [frame_paths[int(i * step)] for i in range(GPT_FRAMES)]

    content = [{"type": "text", "text": GPT_PROMPT}]
    for path in frame_paths:
        content.append({
            "type": "image_url",
            "image_url": {
                "url": f"data:image/jpeg;base64,{encode_image(path)}",
                "detail": "low",   # low detail to save tokens; we have 8 frames
            },
        })

    for attempt in range(GPT_RETRY):
        try:
            response = client.chat.completions.create(
                model=GPT_MODEL,
                messages=[{"role": "user", "content": content}],
                max_tokens=150,
                temperature=0.1,
            )
            raw = response.choices[0].message.content.strip()
            result = json.loads(raw)
            label = result.get("label", "").strip()
            if label not in CLASSES:
                log.warning(f"Unknown label '{label}' from GPT — defaulting to success")
                label = "success"
            return {
                "label":      label,
                "confidence": int(result.get("confidence", 80)),
                "reasoning":  result.get("reasoning", ""),
            }
        except json.JSONDecodeError:
            log.warning(f"GPT returned non-JSON on attempt {attempt+1}: {raw[:80]}")
        except Exception as e:
            log.warning(f"GPT API error on attempt {attempt+1}: {e}")
            time.sleep(2 ** attempt)

    return None   # all attempts failed


# ─── Synthetic Corruption ─────────────────────────────────────────────────────

def corrupt_frames(frames_dir: Path, corruption_type: str, out_dir: Path) -> None:
    """
    Apply a synthetic corruption to a DROID success episode to create a failure.
    Modifies the LAST frame to simulate the failure visually.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    frame_paths = sorted(frames_dir.glob("*.jpg"))
    if not frame_paths:
        return

    for src in frame_paths:
        shutil.copy2(src, out_dir / src.name)

    # Apply corruption to the last frame only
    target = out_dir / frame_paths[-1].name
    img = Image.open(target).convert("RGB")
    arr = np.array(img)

    if corruption_type == "drop_detected":
        # Blur bottom half heavily (simulate dropped item / blur artifact)
        h = arr.shape[0]
        bottom = Image.fromarray(arr[h//2:]).filter(ImageFilter.GaussianBlur(radius=8))
        arr[h//2:] = np.array(bottom)

    elif corruption_type == "placement_miss":
        # Shift the image 15% to the right (simulate item placed off-target)
        shift = int(arr.shape[1] * 0.15)
        arr = np.roll(arr, shift, axis=1)
        arr[:, :shift] = arr[:, shift:shift+1]  # fill left edge

    elif corruption_type == "grip_failure":
        # Truncate: replace last frame with second-to-last (grasp phase never completed)
        if len(frame_paths) >= 2:
            shutil.copy2(out_dir / frame_paths[-2].name, target)
            arr = None  # skip the numpy write below

    elif corruption_type == "wrong_item":
        # Tint the last frame green (crude proxy for a different object)
        arr = arr.astype(np.int16)
        arr[:, :, 0] = np.clip(arr[:, :, 0] - 40, 0, 255)  # reduce red
        arr[:, :, 1] = np.clip(arr[:, :, 1] + 40, 0, 255)  # boost green
        arr = arr.astype(np.uint8)

    if arr is not None:
        Image.fromarray(arr).save(target, quality=88)


CORRUPT_TYPES = ["drop_detected", "placement_miss", "grip_failure", "wrong_item"]


# ─── Main Pipeline ────────────────────────────────────────────────────────────

def process_realsource() -> list[dict]:
    rs_dir = RAW_DIR / "realsource"
    if not rs_dir.exists():
        log.warning("data/raw/realsource/ not found — skipping RealSource")
        return []

    records = []
    for ep_dir in tqdm(sorted(rs_dir.glob("ep_*")), desc="RealSource"):
        quality_file = ep_dir / "quality.json"
        meta_file    = ep_dir / "meta.json"
        frames_dir   = ep_dir / "frames"

        if not quality_file.exists():
            continue

        quality = json.loads(quality_file.read_text())
        meta    = json.loads(meta_file.read_text()) if meta_file.exists() else {}
        label   = map_realsource_quality(quality)

        out_ep = OUT_DIR / ep_dir.name
        if frames_dir.exists():
            out_ep.mkdir(parents=True, exist_ok=True)
            if not (out_ep / "frames").exists():
                shutil.copytree(frames_dir, out_ep / "frames")

        record = {
            "episode_id":  ep_dir.name,
            "source":      "realsource",
            "label":       label,
            "label_idx":   CLASS_IDX[label],
            "task":        meta.get("task", ""),
            "confidence":  100,        # ground-truth annotation
            "labeling":    "annotation",
            "frames_dir":  str((out_ep / "frames").relative_to(OUT_DIR)) if frames_dir.exists() else None,
        }
        records.append(record)

    return records


def process_droid(skip_gpt: bool, no_corrupt: bool) -> list[dict]:
    droid_dir = RAW_DIR / "droid"
    if not droid_dir.exists():
        log.warning("data/raw/droid/ not found — skipping DROID")
        return []

    client = None
    if not skip_gpt:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            log.warning("OPENAI_API_KEY not set — skipping GPT labeling, using success label for all DROID")
            skip_gpt = True
        else:
            client = OpenAI(api_key=api_key)

    records = []
    ep_dirs = sorted(droid_dir.glob("ep_*"))

    for ep_dir in tqdm(ep_dirs, desc="DROID GPT-label"):
        frames_dir = ep_dir / "frames"
        meta_file  = ep_dir / "meta.json"
        if not frames_dir.exists():
            continue

        meta   = json.loads(meta_file.read_text()) if meta_file.exists() else {}
        frames = sorted(frames_dir.glob("*.jpg"))

        # GPT-4o labeling
        if skip_gpt:
            label, conf, reasoning = "success", 80, "GPT skipped"
        else:
            result = label_with_gpt(frames, client)
            if result:
                label, conf, reasoning = result["label"], result["confidence"], result["reasoning"]
            else:
                label, conf, reasoning = "success", 50, "GPT failed — defaulting to success"
                log.warning(f"GPT failed for {ep_dir.name}")

        out_ep = OUT_DIR / ep_dir.name
        out_ep.mkdir(parents=True, exist_ok=True)
        if not (out_ep / "frames").exists():
            shutil.copytree(frames_dir, out_ep / "frames")

        record = {
            "episode_id": ep_dir.name,
            "source":     "droid",
            "label":      label,
            "label_idx":  CLASS_IDX[label],
            "task":       meta.get("task", ""),
            "confidence": conf,
            "reasoning":  reasoning,
            "labeling":   "gpt4o" if not skip_gpt else "default",
            "frames_dir": str((out_ep / "frames").relative_to(OUT_DIR)),
            "corrupted":  False,
        }
        records.append(record)

    if no_corrupt:
        return records

    # Synthetic corruption: corrupt 30% of DROID success episodes
    success_records = [r for r in records if r["label"] == "success"]
    n_corrupt = int(len(success_records) * CORRUPT_RATE)
    to_corrupt = random.sample(success_records, min(n_corrupt, len(success_records)))
    log.info(f"Applying synthetic corruption to {len(to_corrupt)} DROID success episodes")

    new_records = []
    for orig in tqdm(to_corrupt, desc="Synthetic corruption"):
        c_type  = random.choice(CORRUPT_TYPES)
        orig_ep = OUT_DIR / orig["episode_id"] / "frames"
        c_id    = orig["episode_id"] + f"_corrupt_{c_type}"
        c_dir   = OUT_DIR / c_id / "frames"

        corrupt_frames(orig_ep, c_type, c_dir)

        new_records.append({
            **orig,
            "episode_id": c_id,
            "label":       c_type,
            "label_idx":   CLASS_IDX[c_type],
            "labeling":    "synthetic",
            "corrupted":   True,
            "original_ep": orig["episode_id"],
            "frames_dir":  str(c_dir.relative_to(OUT_DIR)),
        })

    return records + new_records


def write_manifest(records: list[dict]) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(MANIFEST, "w") as f:
        for r in records:
            f.write(json.dumps(r) + "\n")
    log.info(f"Manifest written: {len(records)} records → {MANIFEST}")


def print_stats(records: list[dict]) -> None:
    counts = Counter(r["label"] for r in records)
    total  = len(records)
    log.info("\n=== Dataset Stats ===")
    for cls in CLASSES:
        n = counts.get(cls, 0)
        log.info(f"  {cls:<20} {n:>5}  ({100*n/total:.1f}%)")
    log.info(f"  {'TOTAL':<20} {total:>5}")

    # Warn if any class < 200
    for cls in CLASSES[1:]:   # skip success
        if counts.get(cls, 0) < 200:
            log.warning(
                f"Class '{cls}' has only {counts.get(cls,0)} examples (target ≥200). "
                "Consider downloading more data or increasing corruption rate."
            )

    stats = {"counts": dict(counts), "total": total}
    (OUT_DIR / "stats.json").write_text(json.dumps(stats, indent=2))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-gpt",   action="store_true", help="Skip GPT-4o labeling for DROID")
    parser.add_argument("--no-corrupt", action="store_true", help="Skip synthetic corruption")
    args = parser.parse_args()

    records = []
    records += process_realsource()
    records += process_droid(skip_gpt=args.skip_gpt, no_corrupt=args.no_corrupt)

    write_manifest(records)
    print_stats(records)


if __name__ == "__main__":
    main()
