export interface ExtractedFrame {
  dataUrl: string;
  timestampSec: number;
  /** true if this frame was kept after dedup; false = dropped as too similar */
  kept: boolean;
}

export type FrameMode =
  | { type: "count"; count: number }
  | { type: "interval"; intervalSec: number };

/** Returns the video duration in seconds without fully loading it. */
export function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.src = url;
    video.addEventListener("loadedmetadata", () => {
      URL.revokeObjectURL(url);
      resolve(video.duration);
    });
    video.addEventListener("error", () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read video metadata"));
    });
    video.load();
  });
}

// ---------------------------------------------------------------------------
// Tiled perceptual hash
//
// The frame is divided into a GRID×GRID grid of tiles. Each tile gets its own
// dHash (difference hash on a small greyscale thumbnail). Two frames are
// considered "too similar" only when ALL tiles are similar — meaning even a
// small object appearing in one corner of the frame will force the frame to
// be kept.
//
// Per-tile similarity: Hamming distance ≤ TILE_THRESHOLD (out of TILE_BITS).
// Global similarity: fraction of similar tiles ≥ GLOBAL_SIMILAR_FRACTION.
// ---------------------------------------------------------------------------

const GRID = 4;          // 4×4 = 16 tiles
const TILE_HASH_SIZE = 8; // 8×8 dHash per tile → 64 bits per tile
// A tile is "similar" if its Hamming distance is ≤ this (out of 64 bits).
// 10/64 ≈ 84% identical — only truly static/frozen tiles match.
const TILE_THRESHOLD = 10;

// A frame is dropped only if this fraction of tiles are all similar.
// 0.9 = 90% of tiles must be similar → even 2 changed tiles out of 16 keeps the frame.
const GLOBAL_SIMILAR_FRACTION = 0.9;

type TiledHash = boolean[][];

function tileDHash(
  sourceCanvas: HTMLCanvasElement,
  tileX: number,
  tileY: number,
  tileW: number,
  tileH: number
): boolean[] {
  const small = document.createElement("canvas");
  small.width = TILE_HASH_SIZE + 1;
  small.height = TILE_HASH_SIZE;
  const sc = small.getContext("2d")!;
  // Draw just this tile region into the small canvas
  sc.drawImage(
    sourceCanvas,
    tileX, tileY, tileW, tileH,
    0, 0, TILE_HASH_SIZE + 1, TILE_HASH_SIZE
  );
  const data = sc.getImageData(0, 0, TILE_HASH_SIZE + 1, TILE_HASH_SIZE).data;
  const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
  const bits: boolean[] = [];
  for (let y = 0; y < TILE_HASH_SIZE; y++) {
    for (let x = 0; x < TILE_HASH_SIZE; x++) {
      const i = (y * (TILE_HASH_SIZE + 1) + x) * 4;
      const j = (y * (TILE_HASH_SIZE + 1) + x + 1) * 4;
      bits.push(luma(data[i], data[i + 1], data[i + 2]) > luma(data[j], data[j + 1], data[j + 2]));
    }
  }
  return bits;
}

function computeTiledHash(canvas: HTMLCanvasElement): TiledHash {
  const w = canvas.width;
  const h = canvas.height;
  const tileW = Math.floor(w / GRID);
  const tileH = Math.floor(h / GRID);
  const tiles: boolean[][] = [];
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      tiles.push(tileDHash(canvas, col * tileW, row * tileH, tileW, tileH));
    }
  }
  return tiles;
}

function hammingDistance(a: boolean[], b: boolean[]): number {
  let dist = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) dist++;
  return dist;
}

/**
 * Returns true if the two frames are visually too similar to both be worth
 * sending. A frame is only dropped when ≥90% of its tiles are near-identical
 * to the reference — so any localised change (object in a corner, new item
 * on a plate) forces the frame to be kept.
 */
function isTooSimilar(a: TiledHash, b: TiledHash): boolean {
  let similarTiles = 0;
  for (let i = 0; i < a.length; i++) {
    if (hammingDistance(a[i], b[i]) <= TILE_THRESHOLD) {
      similarTiles++;
    }
  }
  return similarTiles / a.length >= GLOBAL_SIMILAR_FRACTION;
}

// ---------------------------------------------------------------------------

/**
 * Extracts frames from a video File using the Canvas API.
 * Mode "count"    — N evenly-spaced frames across the video.
 * Mode "interval" — one frame every X seconds.
 *
 * After extraction, near-duplicate frames are filtered using a tiled
 * perceptual hash so that small localised changes (e.g. an item placed in
 * a corner) are always preserved.
 */
export async function extractFrames(
  file: File,
  mode: FrameMode = { type: "count", count: 6 }
): Promise<ExtractedFrame[]> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.src = url;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      URL.revokeObjectURL(url);
      return reject(new Error("Could not get canvas context"));
    }

    video.addEventListener("error", () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load video"));
    });

    video.addEventListener("loadedmetadata", async () => {
      const duration = video.duration;
      if (!isFinite(duration) || duration <= 0) {
        URL.revokeObjectURL(url);
        return reject(new Error("Could not determine video duration"));
      }

      canvas.width = 640;
      canvas.height = Math.round((video.videoHeight / video.videoWidth) * 640) || 360;

      // Build candidate timestamps
      let timestamps: number[] = [];

      if (mode.type === "count") {
        const count = Math.max(1, mode.count);
        for (let i = 0; i < count; i++) {
          const t = duration * (0.05 + (0.9 * i) / Math.max(count - 1, 1));
          timestamps.push(Math.min(t, duration - 0.01));
        }
      } else {
        const interval = Math.max(0.5, mode.intervalSec);
        let t = interval / 2;
        while (t < duration) {
          timestamps.push(Math.min(t, duration - 0.01));
          t += interval;
        }
        const last = timestamps[timestamps.length - 1] ?? 0;
        if (last < duration * 0.9) {
          timestamps.push(duration * 0.95);
        }
      }

      // Deduplicate timestamps
      const seenTs = new Set<number>();
      timestamps = timestamps
        .map((t) => Math.round(t * 100) / 100)
        .filter((t) => (seenTs.has(t) ? false : (seenTs.add(t), true)))
        .sort((a, b) => a - b);

      // Extract all candidate frames + compute tiled hashes
      const candidates: { dataUrl: string; timestampSec: number; hash: TiledHash }[] = [];

      for (const ts of timestamps) {
        await seekTo(video, ts);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        candidates.push({
          dataUrl: canvas.toDataURL("image/jpeg", 0.85),
          timestampSec: ts,
          hash: computeTiledHash(canvas),
        });
      }

      URL.revokeObjectURL(url);

      // Greedy dedup: drop a frame only if it's globally similar to the last
      // kept frame across ALL tiles — local changes always force a keep.
      const results: ExtractedFrame[] = [];
      let lastKeptHash: TiledHash | null = null;

      for (const c of candidates) {
        const tooSimilar =
          lastKeptHash !== null && isTooSimilar(c.hash, lastKeptHash);

        results.push({
          dataUrl: c.dataUrl,
          timestampSec: c.timestampSec,
          kept: !tooSimilar,
        });

        if (!tooSimilar) {
          lastKeptHash = c.hash;
        }
      }

      resolve(results);
    });

    video.load();
  });
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      setTimeout(resolve, 60);
    };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = time;
  });
}

/** Convert a base64 data URL to a plain base64 string + mime type */
export function dataUrlToBase64(dataUrl: string): { base64: string; mimeType: string } {
  const [header, base64] = dataUrl.split(",");
  const mimeType = header.replace("data:", "").replace(";base64", "");
  return { base64, mimeType };
}
