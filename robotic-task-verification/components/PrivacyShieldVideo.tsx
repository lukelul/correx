"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  src: string;
  className?: string;
}

type ModelStatus = "loading" | "ready" | "detecting" | "unavailable";

// Typed interfaces matching COCO-SSD output shape
interface BBox {
  bbox: [number, number, number, number]; // x, y, w, h
  class: string;
  score: number;
}

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tf: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cocoSsd: any;
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

function pixelateRegion(
  overlayCtx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  x: number,
  y: number,
  w: number,
  h: number,
  scaleX: number,
  scaleY: number
) {
  if (w <= 0 || h <= 0) return;

  const PIXEL_SIZE = 14;

  // Draw the video frame region to a tiny canvas (pixelation source)
  const srcX = Math.max(0, x);
  const srcY = Math.max(0, y);
  const srcW = Math.min(w, video.videoWidth - srcX);
  const srcH = Math.min(h, video.videoHeight - srcY);
  if (srcW <= 0 || srcH <= 0) return;

  const smallW = Math.max(1, Math.floor(srcW / PIXEL_SIZE));
  const smallH = Math.max(1, Math.floor(srcH / PIXEL_SIZE));

  // Offscreen: capture source region
  const cap = document.createElement("canvas");
  cap.width = srcW;
  cap.height = srcH;
  const capCtx = cap.getContext("2d");
  if (!capCtx) return;
  capCtx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);

  // Downscale
  const small = document.createElement("canvas");
  small.width = smallW;
  small.height = smallH;
  const smallCtx = small.getContext("2d");
  if (!smallCtx) return;
  smallCtx.drawImage(cap, 0, 0, smallW, smallH);

  // Draw pixelated back to overlay (no smoothing = blocky pixels)
  const dstX = srcX * scaleX;
  const dstY = srcY * scaleY;
  const dstW = srcW * scaleX;
  const dstH = srcH * scaleY;

  overlayCtx.imageSmoothingEnabled = false;
  overlayCtx.drawImage(small, dstX, dstY, dstW, dstH);
  overlayCtx.imageSmoothingEnabled = true;

  // Blue tint overlay
  overlayCtx.fillStyle = "rgba(59, 130, 246, 0.18)";
  overlayCtx.fillRect(dstX, dstY, dstW, dstH);

  // Border
  overlayCtx.strokeStyle = "rgba(59, 130, 246, 0.6)";
  overlayCtx.lineWidth = 1.5;
  overlayCtx.strokeRect(dstX, dstY, dstW, dstH);

  // Label
  overlayCtx.fillStyle = "rgba(59, 130, 246, 0.85)";
  overlayCtx.fillRect(dstX, dstY, 48, 14);
  overlayCtx.fillStyle = "#fff";
  overlayCtx.font = "bold 9px sans-serif";
  overlayCtx.fillText("PERSON", dstX + 3, dstY + 10);
}

export default function PrivacyShieldVideo({ src, className = "" }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modelRef = useRef<unknown>(null);
  const rafRef = useRef<number>(0);
  const [status, setStatus] = useState<ModelStatus>("loading");
  const [personCount, setPersonCount] = useState(0);

  // Load TF.js + COCO-SSD from CDN once
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        await loadScript(
          "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js"
        );
        await loadScript(
          "https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js"
        );

        if (cancelled) return;
        if (!window.cocoSsd) throw new Error("COCO-SSD not available");

        const model = await window.cocoSsd.load({ base: "lite_mobilenet_v2" });
        if (cancelled) return;
        modelRef.current = model;
        setStatus("ready");
      } catch (err) {
        console.warn("Privacy Shield: model load failed", err);
        if (!cancelled) setStatus("unavailable");
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  // Detection loop — runs whenever model is ready and video is playing
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    if (status !== "ready" && status !== "detecting") return;

    let lastRun = 0;
    const INTERVAL_MS = 500; // detect every 500ms

    const loop = async (now: number) => {
      rafRef.current = requestAnimationFrame(loop);

      if (now - lastRun < INTERVAL_MS) return;
      if (video.paused || video.ended || !video.videoWidth) return;
      if (!modelRef.current) return;

      lastRun = now;
      setStatus("detecting");

      // Sync canvas size to displayed video size
      const displayW = video.clientWidth;
      const displayH = video.clientHeight;
      if (canvas.width !== displayW || canvas.height !== displayH) {
        canvas.width = displayW;
        canvas.height = displayH;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const predictions: BBox[] = await (modelRef.current as any).detect(video);
        const persons = predictions.filter(
          (p) => p.class === "person" && p.score > 0.45
        );

        setPersonCount(persons.length);

        const scaleX = displayW / video.videoWidth;
        const scaleY = displayH / video.videoHeight;

        for (const p of persons) {
          const [x, y, w, h] = p.bbox;
          pixelateRegion(ctx, video, x, y, w, h, scaleX, scaleY);
        }
      } catch {
        // Detection error — skip frame
      }

      setStatus("ready");
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [status]);

  const badgeConfig = {
    loading: {
      bg: "bg-blue-500/80",
      dot: "bg-blue-200 animate-pulse",
      label: "Privacy Shield: Loading…",
    },
    ready: {
      bg: "bg-emerald-500/80",
      dot: "bg-emerald-200",
      label: "Privacy Shield: ON",
    },
    detecting: {
      bg: "bg-emerald-500/80",
      dot: "bg-emerald-200 animate-pulse",
      label: "Privacy Shield: ON",
    },
    unavailable: {
      bg: "bg-gray-500/70",
      dot: "bg-gray-300",
      label: "Privacy Shield: Unavailable",
    },
  };

  const badge = badgeConfig[status];

  return (
    <div className={`relative rounded-xl overflow-hidden bg-gray-900 ${className}`}>
      {/* Video */}
      <video
        ref={videoRef}
        src={src}
        className="w-full max-h-48 object-cover"
        controls
      />

      {/* Canvas overlay — pointer-events-none so video controls still work */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ width: "100%", height: "100%" }}
      />

      {/* Privacy Shield badge */}
      <div
        className={`absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-full ${badge.bg} backdrop-blur-sm`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
        <span className="text-white text-[10px] font-semibold">{badge.label}</span>
      </div>

      {/* Person count (only show when > 0) */}
      {personCount > 0 && (
        <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-full bg-blue-500/80 backdrop-blur-sm">
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="4" r="2" stroke="white" strokeWidth="1.2" />
            <path d="M2 10c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <span className="text-white text-[10px] font-semibold">
            {personCount} blurred
          </span>
        </div>
      )}
    </div>
  );
}
