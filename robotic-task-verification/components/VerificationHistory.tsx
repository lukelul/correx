"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  getHistory,
  deleteEntry,
  clearHistory,
  type HistoryEntry,
} from "@/lib/historyStore";

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return "just now";
}

function RiskBadge({ level }: { level: string }) {
  const cfg: Record<string, string> = {
    low: "bg-emerald-50 text-emerald-700",
    medium: "bg-amber-50 text-amber-700",
    high: "bg-orange-50 text-orange-700",
    critical: "bg-red-50 text-red-700",
  };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cfg[level] ?? cfg.low}`}>
      {level.charAt(0).toUpperCase() + level.slice(1)} risk
    </span>
  );
}

function HistoryCard({
  entry,
  onDelete,
}: {
  entry: HistoryEntry;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isPass = entry.result.verdict === "PASS";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8, scale: 0.97 }}
      transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="bg-white rounded-2xl shadow-soft overflow-hidden"
    >
      {/* Header row */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-gray-50/50 transition-colors"
      >
        {/* Thumbnail */}
        <div className="w-12 h-12 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
          {entry.thumbnailDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={entry.thumbnailDataUrl}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="5" width="18" height="14" rx="2" stroke="#d1d5db" strokeWidth="1.5" />
                <circle cx="8.5" cy="10.5" r="2" stroke="#d1d5db" strokeWidth="1.2" />
                <path d="M3 16l4.5-4 3 3 3-3 5 5" stroke="#d1d5db" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md tracking-wide ${
                isPass
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-red-100 text-red-700"
              }`}
            >
              {entry.result.verdict}
            </span>
            <span className="text-[10px] text-gray-400">
              {formatRelativeTime(entry.timestamp)}
            </span>
          </div>
          <p className="text-sm font-medium text-gray-800 truncate">
            {entry.task}
          </p>
          <p className="text-xs text-gray-400 mt-0.5 truncate">
            {entry.result.summary}
          </p>
        </div>

        {/* Chevron */}
        <motion.svg
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          className="flex-shrink-0"
        >
          <path
            d="M3 5l4 4 4-4"
            stroke="#9ca3af"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </motion.svg>
      </button>

      {/* Expanded details */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 border-t border-gray-50 pt-3 space-y-3">
              {/* Confidence + risk */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-500">
                  Confidence:{" "}
                  <strong
                    className={isPass ? "text-emerald-600" : "text-red-600"}
                  >
                    {entry.result.confidence}%
                  </strong>
                </span>
                <RiskBadge level={entry.result.risk_level} />
              </div>

              {/* Checks */}
              <div className="space-y-1.5">
                {entry.result.checks.map((c) => {
                  const dot =
                    c.status === "pass"
                      ? "bg-emerald-400"
                      : c.status === "fail"
                      ? "bg-red-500"
                      : "bg-amber-400";
                  return (
                    <div key={c.label} className="flex items-start gap-2">
                      <span
                        className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${dot}`}
                      />
                      <div>
                        <span className="text-xs font-medium text-gray-700">
                          {c.label}
                        </span>
                        <p className="text-[11px] text-gray-400 leading-relaxed">
                          {c.detail}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Recommendation */}
              <div className="bg-gray-50 rounded-xl px-3 py-2">
                <p className="text-[11px] text-gray-500 leading-relaxed">
                  <strong className="text-gray-700">Recommendation:</strong>{" "}
                  {entry.result.recommendation}
                </p>
              </div>

              {/* Delete */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(entry.id);
                }}
                className="text-[11px] text-red-400 hover:text-red-600 transition-colors"
              >
                Remove from history
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function VerificationHistory() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    setEntries(getHistory());
  }, []);

  const handleDelete = (id: string) => {
    deleteEntry(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const handleClear = () => {
    clearHistory();
    setEntries([]);
  };

  const passCount = entries.filter((e) => e.result.verdict === "PASS").length;
  const failCount = entries.filter((e) => e.result.verdict === "FAIL").length;

  return (
    <div className="w-full max-w-md mx-auto space-y-4">
      {/* Stats bar */}
      {entries.length > 0 && (
        <div className="bg-white rounded-2xl shadow-soft p-4 flex items-center gap-4">
          <div className="flex-1 text-center">
            <p className="text-xl font-bold text-gray-900">{entries.length}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">Total</p>
          </div>
          <div className="w-px h-8 bg-gray-100" />
          <div className="flex-1 text-center">
            <p className="text-xl font-bold text-emerald-600">{passCount}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">Passed</p>
          </div>
          <div className="w-px h-8 bg-gray-100" />
          <div className="flex-1 text-center">
            <p className="text-xl font-bold text-red-600">{failCount}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">Failed</p>
          </div>
          <div className="w-px h-8 bg-gray-100" />
          <button
            onClick={handleClear}
            className="text-[11px] text-gray-400 hover:text-red-500 transition-colors font-medium"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Entries */}
      {entries.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-soft p-10 text-center">
          <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-4">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="#d1d5db" strokeWidth="1.5" />
              <path d="M12 8v4l2.5 2.5" stroke="#d1d5db" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-400">No verifications yet</p>
          <p className="text-xs text-gray-300 mt-1">
            Run a verification in the Verify tab to see history here
          </p>
        </div>
      ) : (
        <AnimatePresence mode="popLayout">
          {entries.map((entry) => (
            <HistoryCard key={entry.id} entry={entry} onDelete={handleDelete} />
          ))}
        </AnimatePresence>
      )}
    </div>
  );
}
