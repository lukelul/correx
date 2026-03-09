"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import type { VerificationResult as VResult, CheckResult } from "@/app/api/verify/route";

interface Props {
  result: VResult;
  onReset: () => void;
  latencyMs?: number | null;
}

const RISK_CONFIG = {
  low: { label: "Low Risk", color: "text-emerald-600", bg: "bg-emerald-50", dot: "bg-emerald-400" },
  medium: { label: "Medium Risk", color: "text-amber-600", bg: "bg-amber-50", dot: "bg-amber-400" },
  high: { label: "High Risk", color: "text-orange-600", bg: "bg-orange-50", dot: "bg-orange-400" },
  critical: { label: "Critical Risk", color: "text-red-600", bg: "bg-red-50", dot: "bg-red-500" },
};

const STATUS_CONFIG = {
  pass: { label: "Pass", color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-100" },
  fail: { label: "Fail", color: "text-red-600", bg: "bg-red-50", border: "border-red-100" },
  warning: { label: "Warning", color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-100" },
};

function CheckRow({ check, index }: { check: CheckResult; index: number }) {
  const cfg = STATUS_CONFIG[check.status];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 + index * 0.07, duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={`flex items-start gap-3 p-4 rounded-xl border ${cfg.bg} ${cfg.border}`}
    >
      <div className="flex-shrink-0 mt-0.5">
        {check.status === "pass" ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="7" fill="#d1fae5" />
            <path d="M5 8l2 2 4-4" stroke="#059669" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : check.status === "fail" ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="7" fill="#fee2e2" />
            <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#dc2626" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="7" fill="#fef3c7" />
            <path d="M8 5v3.5" stroke="#d97706" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="8" cy="11" r="0.75" fill="#d97706" />
          </svg>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-gray-800">{check.label}</span>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>
            {cfg.label}
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-1 leading-relaxed">{check.detail}</p>
      </div>
    </motion.div>
  );
}

export default function VerificationResult({ result, onReset, latencyMs }: Props) {
  const isPass = result.verdict === "PASS";
  const riskCfg = RISK_CONFIG[result.risk_level];
  const isHighLatency = latencyMs != null && latencyMs > 500;
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!result.corrective_action) return;
    navigator.clipboard.writeText(result.corrective_action);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="w-full space-y-4"
    >
      {/* Verdict Card */}
      <div className={`rounded-2xl p-6 ${isPass ? "bg-emerald-50" : "bg-red-50"}`}>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1, type: "spring", stiffness: 300, damping: 20 }}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold tracking-widest uppercase mb-3 ${
                isPass
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-red-100 text-red-700"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${isPass ? "bg-emerald-500" : "bg-red-500"}`}
              />
              {result.verdict}
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.3 }}
              className="text-sm text-gray-600 leading-relaxed max-w-sm"
            >
              {result.summary}
            </motion.p>
          </div>

          <motion.div
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ delay: 0.15, type: "spring", stiffness: 260, damping: 18 }}
            className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 ml-4 ${
              isPass ? "bg-emerald-100" : "bg-red-100"
            }`}
          >
            {isPass ? (
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                <path d="M5 12l5 5L20 7" stroke="#059669" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6l12 12" stroke="#dc2626" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            )}
          </motion.div>
        </div>

        {/* Confidence + latency row */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="mt-4 space-y-2"
        >
          <div className="flex justify-between items-center mb-1.5">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 font-medium">Confidence</span>
              <span className={`text-xs font-bold ${isPass ? "text-emerald-600" : "text-red-600"}`}>
                {result.confidence}%
              </span>
            </div>
            {latencyMs != null && (
              <span
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  isHighLatency
                    ? "bg-red-100 text-red-600"
                    : "bg-white/60 text-gray-500"
                }`}
              >
                {isHighLatency && "⚠ "}
                {latencyMs.toLocaleString()}ms
              </span>
            )}
          </div>
          <div className="h-1.5 bg-white/60 rounded-full overflow-hidden">
            <motion.div
              className={`h-full rounded-full ${isPass ? "bg-emerald-400" : "bg-red-400"}`}
              initial={{ width: 0 }}
              animate={{ width: `${result.confidence}%` }}
              transition={{ delay: 0.4, duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }}
            />
          </div>
        </motion.div>
      </div>

      {/* Checks */}
      <div className="bg-white rounded-2xl shadow-soft p-5 space-y-2.5">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Compliance Checks
        </h3>
        {result.checks.map((check, i) => (
          <CheckRow key={check.label} check={check} index={i} />
        ))}
      </div>

      {/* Risk & Recommendation */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.35 }}
        className="bg-white rounded-2xl shadow-soft p-5"
      >
        <div className="flex items-center gap-2 mb-3">
          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${riskCfg.bg} ${riskCfg.color}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${riskCfg.dot}`} />
            {riskCfg.label}
          </span>
        </div>
        <p className="text-sm text-gray-600 leading-relaxed">{result.recommendation}</p>
      </motion.div>

      {/* Level 1 — Failure Reasoning */}
      {result.failure_reasoning && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.68, duration: 0.38 }}
          className="rounded-2xl overflow-hidden border border-amber-200"
        >
          <div className="bg-amber-500 px-5 py-3 flex items-center gap-2.5">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="flex-shrink-0">
              <circle cx="8" cy="8" r="7" fill="rgba(255,255,255,0.25)" />
              <path d="M8 5v4" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
              <circle cx="8" cy="12" r="0.8" fill="white" />
            </svg>
            <span className="text-xs font-bold text-white uppercase tracking-widest">Root Cause Analysis</span>
          </div>
          <div className="bg-amber-50 px-5 py-4">
            <p className="text-[11px] text-amber-600 font-semibold uppercase tracking-wider mb-2">Why it failed</p>
            <p className="text-sm text-amber-950 leading-relaxed">{result.failure_reasoning}</p>
          </div>
        </motion.div>
      )}

      {/* Level 2 — Corrective Action */}
      {result.corrective_action && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.78, duration: 0.38 }}
          className="rounded-2xl overflow-hidden border border-blue-200"
        >
          <div className="bg-[#1e40af] px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="flex-shrink-0">
                <circle cx="8" cy="8" r="7" fill="rgba(255,255,255,0.2)" />
                <path d="M5 8h6M9 5.5L11.5 8 9 10.5" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-xs font-bold text-white uppercase tracking-widest">Correction Sequence</span>
            </div>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-200 hover:text-white transition-colors bg-white/10 hover:bg-white/20 px-2.5 py-1 rounded-lg"
            >
              {copied ? (
                <>
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Copied
                </>
              ) : (
                <>
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                    <rect x="4" y="4" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M8 4V2.5A1.5 1.5 0 006.5 1h-4A1.5 1.5 0 001 2.5v4A1.5 1.5 0 002.5 8H4" stroke="currentColor" strokeWidth="1.2" />
                  </svg>
                  Copy
                </>
              )}
            </button>
          </div>
          <div className="bg-[#eff6ff] px-5 py-4">
            <p className="text-[11px] text-blue-600 font-semibold uppercase tracking-wider mb-2">Send to robot controller</p>
            <p className="text-sm text-blue-950 leading-relaxed font-mono">{result.corrective_action}</p>
          </div>
        </motion.div>
      )}

      {/* Reset button */}
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.7 }}
        onClick={onReset}
        className="w-full py-3 rounded-xl text-sm font-medium text-gray-500 hover:text-gray-700 hover:bg-white transition-all duration-200 shadow-soft"
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
      >
        Verify another task
      </motion.button>
    </motion.div>
  );
}
