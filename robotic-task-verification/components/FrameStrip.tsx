"use client";

import { motion } from "framer-motion";
import type { ExtractedFrame } from "@/lib/extractFrames";

interface FrameStripProps {
  frames: ExtractedFrame[];
  isExtracting: boolean;
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function FrameStrip({ frames, isExtracting }: FrameStripProps) {
  if (isExtracting) {
    return (
      <div className="mt-3">
        <div className="flex items-center gap-2 mb-2">
          <motion.div
            className="w-1.5 h-1.5 rounded-full bg-blue-400"
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1, repeat: Infinity }}
          />
          <span className="text-xs text-gray-400">Extracting & deduplicating frames…</span>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <motion.div
              key={i}
              className="flex-shrink-0 w-16 h-10 rounded-lg bg-gray-100"
              animate={{ opacity: [0.4, 0.8, 0.4] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.1 }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (frames.length === 0) return null;

  const keptCount = frames.filter((f) => f.kept).length;

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-400">
          {frames.length} sampled ·{" "}
          <span className="text-blue-500 font-medium">{keptCount} unique</span>
          {frames.length - keptCount > 0 && (
            <span className="text-gray-300"> · {frames.length - keptCount} skipped</span>
          )}
        </span>
        <span className="text-xs text-gray-300">
          {formatTime(frames[0].timestampSec)} – {formatTime(frames[frames.length - 1].timestampSec)}
        </span>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {frames.map((frame, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.03, duration: 0.2 }}
            className="relative flex-shrink-0 group"
            title={frame.kept ? `Frame at ${formatTime(frame.timestampSec)}` : `Skipped — too similar to previous (${formatTime(frame.timestampSec)})`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={frame.dataUrl}
              alt={`Frame at ${formatTime(frame.timestampSec)}`}
              className={`w-16 h-10 object-cover rounded-lg ring-1 transition-all duration-200 ${
                frame.kept
                  ? "ring-black/5 opacity-100"
                  : "ring-black/5 opacity-25 grayscale"
              }`}
            />

            {/* Timestamp on hover */}
            <div className="absolute bottom-0 inset-x-0 bg-black/50 rounded-b-lg px-1 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <span className="text-white text-[9px] font-medium">
                {formatTime(frame.timestampSec)}
              </span>
            </div>

            {/* Frame index badge (kept frames only) */}
            {frame.kept && (
              <div className="absolute top-1 left-1 w-3.5 h-3.5 rounded-full bg-blue-500/80 flex items-center justify-center">
                <span className="text-white text-[8px] font-bold">
                  {frames.slice(0, i + 1).filter((f) => f.kept).length}
                </span>
              </div>
            )}

            {/* Skip indicator */}
            {!frame.kept && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-4 h-4 rounded-full bg-black/30 flex items-center justify-center">
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                    <path d="M1.5 1.5l5 5M6.5 1.5l-5 5" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                </div>
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
