"""
1_download.py — Download and pre-process DROID + RealSource World datasets.

DROID
-----
Downloaded from Google Cloud Storage using gsutil.
    gsutil -m cp -r gs://gresearch/robotics/droid_100 data/raw/droid_raw
Then read with tensorflow_datasets (RLDS format).

RealSource World
----------------
LeRobot-format dataset on HuggingFace (gated — requires HF_TOKEN).
Downloaded via hf_hub_download (direct file access, no load_dataset):
  - <task>/meta/sub_tasks.jsonl  — quality annotations per episode
  - <task>/videos/chunk-XXX/<camera>/episode_XXXXXX.mp4  — video files
Frames extracted with OpenCV.

Outputs
-------
data/raw/droid/          Up to --droid-limit episodes, exterior camera only
                         Each episode: frames/  (JPEG), meta.json
data/raw/realsource/     All episodes with quality annotations
                         Each episode: frames/  (JPEG), meta.json, quality.json
"""

import os
import json
import shutil
import logging
import argparse
import subprocess
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image
from tqdm import tqdm

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ─── Config ───────────────────────────────────────────────────────────────────

DROID_GCS_PATH         = "gs://gresearch/robotics/droid_100"   # 2GB, 100 episodes
OUT_DIR                = Path("data/raw")

DROID_MAX_EPISODES     = 500
DROID_FRAMES_PER_EP    = 8
DROID_TARGET_TASKS     = [
    "pick", "place", "grasp", "put", "move", "transfer", "stack", "retrieve",
]

REALSOURCE_DATASET          = "RealSourceData/RealSource-World"
REALSOURCE_FRAMES_PER_EP    = 16
REALSOURCE_MAX_SUCCESS      = 500   # max success episodes to download (failures = all)

# ─── Helpers ──────────────────────────────────────────────────────────────────

def save_frames(frames: list, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for i, frame in enumerate(frames):
        if isinstance(frame, np.ndarray):
            frame = Image.fromarray(frame.astype(np.uint8))
        frame.save(out_dir / f"frame_{i:04d}.jpg", quality=90)


def sample_indices(total: int, n: int) -> list[int]:
    if total <= n:
        return list(range(total))
    step = total / n
    return [int(i * step) for i in range(n)]


def is_pick_and_place(task_text: str) -> bool:
    task_lower = task_text.lower()
    return any(kw in task_lower for kw in DROID_TARGET_TASKS)


# ─── DROID ────────────────────────────────────────────────────────────────────

def _download_droid_gcs(dest_parent: Path) -> None:
    """Download DROID 100-episode sample from GCS using gsutil."""
    log.info(f"Downloading DROID from {DROID_GCS_PATH} (~2GB, may take a while)…")
    dest_parent.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.run(
            ["gsutil", "-m", "cp", "-r", DROID_GCS_PATH, str(dest_parent)],
            check=True,
        )
    except FileNotFoundError:
        raise RuntimeError(
            "gsutil not found. Install it:\n"
            "  pip install gsutil\n"
            "or install the Google Cloud SDK: https://cloud.google.com/sdk/docs/install"
        )


def _load_droid_tfds(raw_dir: Path):
    """Load DROID dataset using tensorflow_datasets from the downloaded RLDS directory.

    gsutil cp -r gs://.../droid_100 <OUT_DIR> creates <OUT_DIR>/droid_100/1.0.0/...
    We find the version subdirectory dynamically.
    """
    import tensorflow_datasets as tfds

    # Try the raw_dir itself first (it may contain dataset_info.json directly)
    if (raw_dir / "dataset_info.json").exists():
        return tfds.builder_from_directory(str(raw_dir)).as_dataset(split="train")

    # Find the first versioned subdirectory (e.g. 1.0.0, 0.1.0)
    version_dirs = sorted([d for d in raw_dir.iterdir() if d.is_dir()])
    for vdir in version_dirs:
        if (vdir / "dataset_info.json").exists():
            log.info(f"Found TFDS version dir: {vdir}")
            return tfds.builder_from_directory(str(vdir)).as_dataset(split="train")

    raise RuntimeError(f"Could not find dataset_info.json under {raw_dir}")


def _iter_droid_steps(episode) -> list[dict]:
    """Convert a TFDS episode's steps into a list of numpy dicts."""
    return list(episode["steps"].as_numpy_iterator())


def download_droid(max_episodes: int) -> None:
    log.info("=== DROID ===")
    # gsutil cp -r gs://.../droid_100 OUT_DIR  →  OUT_DIR/droid_100/1.0.0/...
    raw_dir = OUT_DIR / "droid_100"
    out     = OUT_DIR / "droid"
    out.mkdir(parents=True, exist_ok=True)

    if not raw_dir.exists():
        _download_droid_gcs(OUT_DIR)
    else:
        log.info(f"Using cached DROID download at {raw_dir}")

    import tensorflow as tf
    ds = _load_droid_tfds(raw_dir)

    saved         = 0
    skipped_task  = 0
    skipped_cam   = 0

    for episode in tqdm(ds, desc="DROID episodes", unit="ep"):
        if saved >= max_episodes:
            break

        steps = _iter_droid_steps(episode)
        if not steps:
            continue

        # language_instruction is a step-level field (bytes); grab from first step
        task_raw = steps[0].get("language_instruction", b"")
        task = task_raw.decode("utf-8", errors="ignore") if isinstance(task_raw, (bytes, bytearray)) else str(task_raw)
        if not is_pick_and_place(task):
            skipped_task += 1
            continue

        # Observation keys confirmed: exterior_image_1_left, exterior_image_2_left, wrist_image_left
        obs       = steps[0]["observation"]
        ext_keys  = [k for k in obs.keys() if "exterior" in k.lower() and "image" in k.lower()]
        if not ext_keys:
            skipped_cam += 1
            continue
        cam_key = ext_keys[0]

        # Sample evenly-spaced frames
        indices = sample_indices(len(steps), DROID_FRAMES_PER_EP)
        frames  = []
        for idx in indices:
            raw = steps[idx]["observation"][cam_key]
            # TFDS Image features: decoded uint8 numpy array (H, W, C)
            # Raw bytes fallback for non-Image tensor features
            if isinstance(raw, np.ndarray):
                frames.append(Image.fromarray(raw.astype(np.uint8)))
            elif isinstance(raw, (bytes, bytearray)):
                frames.append(Image.open(BytesIO(bytes(raw))))

        if not frames:
            skipped_cam += 1
            continue

        ep_dir = out / f"ep_{saved:05d}"
        save_frames(frames, ep_dir / "frames")
        (ep_dir / "meta.json").write_text(json.dumps({
            "episode_id": saved,
            "source":     "droid",
            "task":       task,
            "n_frames":   len(frames),
            "camera":     cam_key,
        }, indent=2))
        saved += 1

    log.info(f"DROID: saved {saved} (skipped task={skipped_task}, camera={skipped_cam})")
    (out / "summary.json").write_text(json.dumps({"episodes": saved}, indent=2))


# ─── RealSource World ─────────────────────────────────────────────────────────

def _download_realsource_hf_datasets(token: str, out: Path) -> None:
    """Download RealSource World via hf_hub_download (bypasses load_dataset hang).

    Dataset layout (LeRobot format):
      <task>/meta/sub_tasks.jsonl           — quality labels per episode
      <task>/videos/chunk-XXX/<cam>/episode_XXXXXX.mp4
    """
    import re
    import cv2
    from huggingface_hub import HfApi, hf_hub_download

    api = HfApi(token=token)
    log.info("Listing RealSource World files to find task directories…")

    all_paths = list(api.list_repo_files(REALSOURCE_DATASET, repo_type="dataset"))
    task_dirs = sorted({
        m.group(1)
        for p in all_paths
        if (m := re.match(r"^(.+)/meta/sub_tasks\.jsonl$", p))
    })
    log.info(f"Found {len(task_dirs)} task directories")

    saved         = 0
    skipped       = 0
    success_saved = 0

    for task_dir in tqdm(task_dirs, desc="RealSource tasks", unit="task"):
        # Download and parse quality annotations for this task
        try:
            jsonl_local = hf_hub_download(
                repo_id=REALSOURCE_DATASET,
                repo_type="dataset",
                filename=f"{task_dir}/meta/sub_tasks.jsonl",
                token=token,
            )
        except Exception as e:
            log.warning(f"Skipping {task_dir}: could not fetch sub_tasks.jsonl — {e}")
            skipped += 1
            continue

        episodes = []
        with open(jsonl_local, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        episodes.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass

        for ep in episodes:
            qa = ep.get("quality_assessments", {})
            if not qa:
                skipped += 1
                continue

            quality = {
                "movement_fluency":  qa.get("movement_fluency"),
                "grasp_success":     qa.get("grasp_success"),
                "placement_quality": qa.get("placement_quality"),
                "no_drop":           qa.get("no_drop"),
                "overall_valid":     qa.get("overall_valid"),
            }

            # Skip success episodes once cap is reached (always download failures)
            is_success = (
                qa.get("overall_valid", "").upper() == "VALID"
                and all(qa.get(k, "PASS").upper() == "PASS"
                        for k in ("movement_fluency", "grasp_success", "placement_quality", "no_drop"))
            )
            if is_success and success_saved >= REALSOURCE_MAX_SUCCESS:
                skipped += 1
                continue

            # Derive video path: sub_tasks.jsonl has videos=null for most episodes;
            # construct path from episode_index (chunk size = 1000).
            ep_idx = ep.get("episode_index", 0)
            videos = ep.get("videos") or {}
            video_rel = (
                videos.get("observation.images.head_camera")
                or videos.get("observation.images.left_hand_camera")
                or next(iter(videos.values()), None)
                or f"videos/chunk-{ep_idx // 1000:03d}/observation.images.head_camera/episode_{ep_idx:06d}.mp4"
            )

            task_name = ep.get("task", task_dir)
            frames: list[Image.Image] = []

            if video_rel:
                try:
                    mp4_local = hf_hub_download(
                        repo_id=REALSOURCE_DATASET,
                        repo_type="dataset",
                        filename=f"{task_dir}/{video_rel}",
                        token=token,
                    )
                    cap   = cv2.VideoCapture(mp4_local)
                    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
                    for idx in sample_indices(total, REALSOURCE_FRAMES_PER_EP):
                        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
                        ret, bgr = cap.read()
                        if ret:
                            frames.append(Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)))
                    cap.release()
                except Exception as e:
                    log.warning(f"Could not extract frames from {task_dir}/{video_rel}: {e}")

            ep_dir = out / f"ep_{saved:05d}"
            ep_dir.mkdir(parents=True, exist_ok=True)
            if frames:
                save_frames(frames, ep_dir / "frames")

            (ep_dir / "meta.json").write_text(json.dumps({
                "episode_id":    saved,
                "source":        "realsource",
                "task":          str(task_name),
                "n_frames":      len(frames),
                "task_dir":      task_dir,
                "episode_index": ep.get("episode_index"),
            }, indent=2))
            (ep_dir / "quality.json").write_text(json.dumps(quality, indent=2))
            saved += 1
            if is_success:
                success_saved += 1

    log.info(f"RealSource: saved {saved} (success={success_saved}, skipped={skipped})")
    (out / "summary.json").write_text(json.dumps({"episodes": saved}, indent=2))


def download_realsource() -> None:
    log.info("=== RealSource World ===")
    token = os.environ.get("HF_TOKEN")
    if not token:
        try:
            from huggingface_hub import get_token
            token = get_token()
        except Exception:
            pass
    if not token:
        raise RuntimeError(
            "No HuggingFace token found. Run `huggingface-cli login` or set HF_TOKEN env var."
        )

    out = OUT_DIR / "realsource"
    out.mkdir(parents=True, exist_ok=True)

    # datasets-server API cannot serve gated repo content server-side;
    # use load_dataset directly which authenticates with the user's token.
    _download_realsource_hf_datasets(token, out)


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--droid-only",      action="store_true")
    parser.add_argument("--realsource-only", action="store_true")
    parser.add_argument("--droid-limit",     type=int, default=DROID_MAX_EPISODES,
                        help="Max DROID episodes to use (default: 500; capped at 100 for the sample download)")
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    if not args.realsource_only:
        download_droid(args.droid_limit)

    if not args.droid_only:
        download_realsource()

    log.info(f"Done. Data saved to {OUT_DIR.resolve()}/")


if __name__ == "__main__":
    main()
