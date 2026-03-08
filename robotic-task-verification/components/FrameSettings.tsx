"use client";

import { motion, AnimatePresence } from "framer-motion";
import type { FrameMode, ExtractedFrame } from "@/lib/extractFrames";

interface FrameSettingsProps {
  mode: FrameMode;
  onChange: (mode: FrameMode) => void;
  videoDuration: number;
  frames: ExtractedFrame[];
  disabled?: boolean;
}

// Must match the server-side constants in route.ts
const TOKENS_HIGH = 1700;
const TOKENS_LOW = 85;
const TPM_BUDGET = 25000;
const MAX_FRAMES = 20;

function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function estimatedCandidateCount(mode: FrameMode, duration: number): number {
  if (mode.type === "count") return mode.count;
  if (duration <= 0) return 0;
  return Math.floor(duration / mode.intervalSec) + 1;
}

interface TokenBudget {
  framesSent: number;
  detail: "high" | "low";
  estimatedTokens: number;
  pct: number;
  capped: boolean;
}

function calcTokenBudget(keptCount: number): TokenBudget {
  const framesSent = Math.min(keptCount, MAX_FRAMES);
  const capped = keptCount > MAX_FRAMES;
  const tokensIfHigh = framesSent * TOKENS_HIGH;
  const detail: "high" | "low" = tokensIfHigh <= TPM_BUDGET ? "high" : "low";
  const estimatedTokens = framesSent * (detail === "high" ? TOKENS_HIGH : TOKENS_LOW);
  const pct = Math.min((estimatedTokens / TPM_BUDGET) * 100, 100);
  return { framesSent, detail, estimatedTokens, pct, capped };
}

export default function FrameSettings({
  mode,
  onChange,
  videoDuration,
  frames,
  disabled,
}: FrameSettingsProps) {
  const isCount = mode.type === "count";
  const candidateCount = estimatedCandidateCount(mode, videoDuration);
  const keptCount = frames.length > 0 ? frames.filter((f) => f.kept).length : null;
  const droppedCount = frames.length > 0 ? frames.filter((f) => !f.kept).length : 0;
  const budget = keptCount !== null ? calcTokenBudget(keptCount) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="mt-3 pt-3 border-t border-gray-100"
    >
      {/* Mode toggle */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-gray-400 font-medium">Frame extraction</span>
        <div className="flex items-center bg-gray-100 rounded-lg p-0.5 gap-0.5">
          <button
            onClick={() =>
              !disabled &&
              onChange({
                type: "count",
                count: isCount ? (mode as { type: "count"; count: number }).count : 6,
              })
            }
            disabled={disabled}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-150 ${
              isCount ? "bg-white text-gray-700 shadow-sm" : "text-gray-400 hover:text-gray-600"
            }`}
          >
            By count
          </button>
          <button
            onClick={() =>
              !disabled &&
              onChange({
                type: "interval",
                intervalSec: !isCount
                  ? (mode as { type: "interval"; intervalSec: number }).intervalSec
                  : 2,
              })
            }
            disabled={disabled}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-150 ${
              !isCount ? "bg-white text-gray-700 shadow-sm" : "text-gray-400 hover:text-gray-600"
            }`}
          >
            By interval
          </button>
        </div>
      </div>

      {/* Slider */}
      {isCount ? (
        <CountSlider
          value={(mode as { type: "count"; count: number }).count}
          onChange={(v) => onChange({ type: "count", count: v })}
          disabled={disabled}
        />
      ) : (
        <IntervalSlider
          value={(mode as { type: "interval"; intervalSec: number }).intervalSec}
          onChange={(v) => onChange({ type: "interval", intervalSec: v })}
          videoDuration={videoDuration}
          disabled={disabled}
        />
      )}

      {/* Frame count summary */}
      <div className="flex items-center justify-between mt-2.5">
        <span className="text-xs text-gray-300">
          {videoDuration > 0 && `${formatDuration(videoDuration)} video`}
        </span>
        <span className="text-xs font-medium">
          {keptCount !== null ? (
            <>
              <span className="text-blue-500">{keptCount} unique</span>
              {droppedCount > 0 && (
                <span className="text-gray-300">
                  {" "}· {droppedCount} duplicate{droppedCount !== 1 ? "s" : ""} skipped
                </span>
              )}
            </>
          ) : (
            <span className="text-gray-300">
              ~{candidateCount} candidate{candidateCount !== 1 ? "s" : ""}
            </span>
          )}
        </span>
      </div>

      {/* Token budget indicator — only shown after extraction */}
      <AnimatePresence>
        {budget && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-3 overflow-hidden"
          >
            <div className="rounded-xl bg-gray-50 px-3 py-2.5 space-y-2">
              {/* Bar */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">
                    Token estimate
                  </span>
                  <span
                    className={`text-[10px] font-semibold ${
                      budget.detail === "low" ? "text-amber-500" : "text-emerald-500"
                    }`}
                  >
                    ~{(budget.estimatedTokens / 1000).toFixed(1)}k / 30k TPM
                  </span>
                </div>
                <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <motion.div
                    className={`h-full rounded-full ${
                      budget.detail === "low" ? "bg-amber-400" : "bg-emerald-400"
                    }`}
                    initial={{ width: 0 }}
                    animate={{ width: `${budget.pct}%` }}
                    transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                </div>
              </div>

              {/* Detail mode + cap notices */}
              <div className="flex flex-wrap gap-1.5">
                <span
                  className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${
                    budget.detail === "high"
                      ? "bg-emerald-100 text-emerald-600"
                      : "bg-amber-100 text-amber-600"
                  }`}
                >
                  <span
                    className={`w-1 h-1 rounded-full ${
                      budget.detail === "high" ? "bg-emerald-500" : "bg-amber-500"
                    }`}
                  />
                  {budget.detail === "high" ? "High detail" : "Low detail (auto)"}
                </span>

                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                  {budget.framesSent} frame{budget.framesSent !== 1 ? "s" : ""} sent
                  {budget.capped && " (capped at 20)"}
                </span>
              </div>

              {budget.detail === "low" && (
                <p className="text-[10px] text-amber-600 leading-relaxed">
                  Too many frames for high detail — switched to low detail automatically.
                  Reduce frame count for sharper analysis.
                </p>
              )}
              {budget.capped && (
                <p className="text-[10px] text-gray-400 leading-relaxed">
                  {keptCount} unique frames extracted but only 20 sent, evenly subsampled to preserve temporal coverage.
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function CountSlider({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const MIN = 2;
  const MAX = 60;
  const pct = ((value - MIN) / (MAX - MIN)) * 100;

  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-xs text-gray-500">
          <span className="font-semibold text-gray-700">{value}</span> candidate frames
        </span>
        <span className="text-xs text-gray-300">{MIN}–{MAX}</span>
      </div>
      <div className="relative h-5 flex items-center">
        <div className="absolute inset-x-0 h-1.5 bg-gray-100 rounded-full" />
        <div
          className="absolute left-0 h-1.5 bg-blue-400 rounded-full transition-all duration-100"
          style={{ width: `${pct}%` }}
        />
        <input
          type="range"
          min={MIN}
          max={MAX}
          step={1}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer disabled:cursor-not-allowed h-5"
        />
        <div
          className="absolute w-4 h-4 bg-white border-2 border-blue-400 rounded-full shadow-sm pointer-events-none transition-all duration-100"
          style={{ left: `calc(${pct}% - 8px)` }}
        />
      </div>
    </div>
  );
}

function IntervalSlider({
  value,
  onChange,
  videoDuration,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  videoDuration: number;
  disabled?: boolean;
}) {
  const SNAPS = [0.5, 1, 2, 3, 5, 10, 15, 30, 60];
  const idx = SNAPS.indexOf(value) === -1 ? 2 : SNAPS.indexOf(value);
  const pct = (idx / (SNAPS.length - 1)) * 100;
  const label = value < 1 ? `${value * 1000}ms` : value === 1 ? "1 sec" : `${value} sec`;
  const candidateCount = videoDuration > 0 ? Math.floor(videoDuration / value) + 1 : null;

  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-xs text-gray-500">
          Every <span className="font-semibold text-gray-700">{label}</span>
        </span>
        {candidateCount !== null && (
          <span className="text-xs text-gray-300">
            ~{candidateCount} candidate{candidateCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      <div className="relative h-5 flex items-center">
        <div className="absolute inset-x-0 h-1.5 bg-gray-100 rounded-full" />
        <div
          className="absolute left-0 h-1.5 bg-blue-400 rounded-full transition-all duration-100"
          style={{ width: `${pct}%` }}
        />
        <input
          type="range"
          min={0}
          max={SNAPS.length - 1}
          step={1}
          value={idx}
          disabled={disabled}
          onChange={(e) => onChange(SNAPS[Number(e.target.value)])}
          className="absolute inset-0 w-full opacity-0 cursor-pointer disabled:cursor-not-allowed h-5"
        />
        <div
          className="absolute w-4 h-4 bg-white border-2 border-blue-400 rounded-full shadow-sm pointer-events-none transition-all duration-100"
          style={{ left: `calc(${pct}% - 8px)` }}
        />
      </div>
      <div className="flex justify-between mt-1 px-0.5">
        {["0.5s", "1s", "2s", "3s", "5s", "10s", "15s", "30s", "1m"].map((l, i) => (
          <span
            key={l}
            className={`text-[9px] transition-colors ${
              i === idx ? "text-blue-400 font-semibold" : "text-gray-200"
            }`}
          >
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}
