"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence, animate } from "framer-motion";
import { generateNextEvent, type WarehouseEvent } from "@/lib/warehouseSimulator";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Correction {
  id: string;
  timestamp: number;
  message: string;
  failureType: string;
  sent: boolean;
}

interface EventMeta {
  latencyMs?: number;
  emailSent?: boolean;
  smsSent?: boolean;
  wmsAcknowledged?: boolean;
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

function LatencySparkline({ latencies }: { latencies: number[] }) {
  if (latencies.length < 2) {
    return <span className="text-[10px] text-gray-300">Collecting data…</span>;
  }
  const W = 80;
  const H = 24;
  const max = Math.max(...latencies, 500);
  const min = Math.min(...latencies, 50);
  const range = max - min || 1;
  const step = W / (latencies.length - 1);
  const pts = latencies
    .map((v, i) => `${i * step},${H - ((v - min) / range) * (H - 2) - 1}`)
    .join(" ");
  const last = latencies[latencies.length - 1];
  const color = last > 500 ? "#ef4444" : last > 300 ? "#f59e0b" : "#10b981";

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: "visible" }}>
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─── Monthly Report Modal ─────────────────────────────────────────────────────

function MonthlyReportModal({
  allEvents,
  allLatencies,
  totalCost,
  missedCount,
  onClose,
}: {
  allEvents: WarehouseEvent[];
  allLatencies: number[];
  totalCost: number;
  missedCount: number;
  onClose: () => void;
}) {
  const failures = allEvents.filter((e) => e.status === "failure");
  const caught = failures.filter((e) => !e.missed);
  const byHigh = caught.filter((e) => e.severity === "HIGH").length;
  const byMedium = caught.filter((e) => e.severity === "MEDIUM").length;
  const byLow = caught.filter((e) => e.severity === "LOW").length;
  const accuracy =
    failures.length > 0
      ? ((caught.length / failures.length) * 100).toFixed(1)
      : "100.0";
  const avgLatency =
    allLatencies.length > 0
      ? Math.round(allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length)
      : 0;

  const rows = [
    { label: "Total Tasks", value: allEvents.length.toLocaleString() },
    { label: "Failures Caught", value: caught.length.toString() },
    { label: "  — HIGH Severity", value: byHigh.toString(), indent: true },
    { label: "  — MEDIUM Severity", value: byMedium.toString(), indent: true },
    { label: "  — LOW Severity", value: byLow.toString(), indent: true },
    { label: "False Negatives", value: missedCount.toString(), alarm: missedCount > 0 },
    { label: "Total Cost Prevented", value: `$${totalCost.toLocaleString()}`, highlight: true },
    { label: "Detection Accuracy", value: `${accuracy}%` },
    { label: "Avg Latency", value: `${avgLatency}ms`, warn: avgLatency > 500 },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.92, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.92, y: 20 }}
        transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-[#1e40af] px-6 py-4">
          <p className="text-blue-200 text-[10px] font-bold uppercase tracking-wider">Correx</p>
          <h2 className="text-white text-lg font-bold mt-0.5">Session Report</h2>
          <p className="text-blue-300 text-xs mt-0.5">
            {new Date().toLocaleDateString("en", { month: "long", year: "numeric" })}
          </p>
        </div>

        <div className="px-6 py-4 space-y-1">
          {rows.map((r, i) => (
            <div
              key={i}
              className={`flex justify-between items-center py-1.5 border-b border-gray-50 ${
                r.indent ? "pl-3" : ""
              }`}
            >
              <span className={`text-xs ${r.indent ? "text-gray-400" : "text-gray-500"}`}>
                {r.label}
              </span>
              <span
                className={`text-xs font-semibold ${
                  r.highlight
                    ? "text-blue-600 text-sm"
                    : r.alarm
                    ? "text-red-600"
                    : r.warn
                    ? "text-amber-600"
                    : "text-gray-900"
                }`}
              >
                {r.value}
              </span>
            </div>
          ))}
        </div>

        <div className="mx-6 mb-5 p-3.5 bg-blue-50 rounded-xl border border-blue-100">
          <p className="text-xs text-blue-800 font-medium leading-relaxed text-center">
            &ldquo;Correx prevented an estimated{" "}
            <span className="font-bold">${totalCost.toLocaleString()}</span> across{" "}
            <span className="font-bold">{allEvents.length.toLocaleString()}</span> tasks this
            session.&rdquo;
          </p>
        </div>

        <div className="px-6 pb-5">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl text-sm font-semibold bg-gray-900 text-white hover:bg-gray-800 transition-colors"
          >
            Close
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Severity Badge ───────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: "LOW" | "MEDIUM" | "HIGH" }) {
  const cfg = {
    LOW: "bg-yellow-50 text-yellow-700",
    MEDIUM: "bg-orange-50 text-orange-700",
    HIGH: "bg-red-50 text-red-700",
  };
  return (
    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md tracking-wide ${cfg[severity]}`}>
      {severity}
    </span>
  );
}

// ─── Event Row ────────────────────────────────────────────────────────────────

function EventRow({
  event,
  meta,
  wmsMode,
}: {
  event: WarehouseEvent;
  meta?: EventMeta;
  wmsMode: boolean;
}) {
  const isFailure = event.status === "failure";
  const isMissed = event.missed;
  const lat = meta?.latencyMs;
  const isSlowLatency = lat != null && lat > 500;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex flex-col gap-1.5 py-2.5 px-3 rounded-xl text-xs ${
        isMissed
          ? "bg-red-100 border-2 border-red-400 animate-pulse"
          : isFailure
          ? "bg-red-50 border border-red-100"
          : "hover:bg-gray-50/50"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span className="text-gray-300 font-mono text-[10px] mt-0.5 flex-shrink-0 w-14">
          {new Date(event.timestamp).toLocaleTimeString("en", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          })}
        </span>

        <div className="flex-shrink-0 mt-0.5">
          {isMissed ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 1.5L10.5 9.5H1.5L6 1.5Z" fill="#fee2e2" stroke="#dc2626" strokeWidth="0.8" />
              <path d="M6 4.5v2" stroke="#dc2626" strokeWidth="1" strokeLinecap="round" />
              <circle cx="6" cy="7.8" r="0.5" fill="#dc2626" />
            </svg>
          ) : isFailure ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 1.5L10.5 9.5H1.5L6 1.5Z" fill="#fee2e2" stroke="#ef4444" strokeWidth="0.8" />
              <path d="M6 4.5v2" stroke="#ef4444" strokeWidth="1" strokeLinecap="round" />
              <circle cx="6" cy="7.8" r="0.5" fill="#ef4444" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="4.5" fill="#d1fae5" stroke="#059669" strokeWidth="0.8" />
              <path d="M4 6l1.5 1.5L8 4" stroke="#059669" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <span
            className={`leading-relaxed ${
              isMissed
                ? "text-red-800 font-bold"
                : isFailure
                ? "text-red-700 font-medium"
                : "text-gray-600"
            }`}
          >
            {isMissed ? "⚠ MISSED: " : ""}
            {event.action}
          </span>
          {event.location && !isFailure && (
            <span className="text-gray-400 ml-1">· {event.location}</span>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {isFailure && event.severity && <SeverityBadge severity={event.severity} />}
          {lat != null && (
            <span
              className={`text-[9px] font-mono px-1 py-0.5 rounded ${
                isSlowLatency ? "text-red-600 bg-red-50 font-bold" : "text-gray-400"
              }`}
            >
              {isSlowLatency && "⚠"}
              {lat}ms
            </span>
          )}
        </div>
      </div>

      {/* Failure detail row */}
      {isFailure && !isMissed && (
        <div className="ml-[calc(56px+20px)] space-y-1">
          {event.triggerSignal && (
            <p className="text-[10px] text-gray-500">
              <span className="font-semibold text-gray-600">Signal:</span> {event.triggerSignal}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            {event.confidence != null && (
              <span className="text-[9px] font-semibold bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded-md">
                {event.confidence}% confidence
              </span>
            )}
            {event.costImpact != null && (
              <span className="text-[9px] font-semibold bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-md">
                ${event.costImpact} impact
              </span>
            )}
            {event.robotId && (
              <span className="text-[9px] text-gray-400 font-mono">{event.robotId}</span>
            )}
            {wmsMode && meta?.wmsAcknowledged && (
              <span className="text-[9px] font-semibold bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded-md">
                Pushed to WMS ✓
              </span>
            )}
            {meta?.emailSent && (
              <span className="text-[9px] font-semibold bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-md">
                📧 Email Sent
              </span>
            )}
            {meta?.smsSent && (
              <span className="text-[9px] font-semibold bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded-md">
                📱 SMS Sent
              </span>
            )}
          </div>
        </div>
      )}

      {/* Missed detail */}
      {isMissed && (
        <div className="ml-[calc(56px+20px)]">
          <p className="text-[10px] font-bold text-red-700">
            FALSE NEGATIVE — this failure escaped without correction
          </p>
        </div>
      )}
    </motion.div>
  );
}

// ─── Correction Item ──────────────────────────────────────────────────────────

function CorrectionItem({ c }: { c: Correction }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16, scale: 0.96 }}
      transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="bg-gray-50 rounded-xl p-3 border border-gray-100"
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-[10px] font-semibold text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded-md">
          {c.failureType}
        </span>
        <AnimatePresence mode="wait">
          {c.sent ? (
            <motion.span
              key="sent"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-[10px] font-semibold text-emerald-600 flex items-center gap-1 flex-shrink-0"
            >
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                <path d="M2 6l3 3 5-5" stroke="#059669" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Sent to Robot
            </motion.span>
          ) : (
            <motion.span
              key="pending"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-[10px] text-gray-400 flex items-center gap-1"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              Queued
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <p className="text-xs text-gray-700 leading-relaxed">{c.message}</p>
      <p className="text-[10px] text-gray-400 mt-1">
        {new Date(c.timestamp).toLocaleTimeString()}
      </p>
    </motion.div>
  );
}

// ─── Feedback Loop Diagram ────────────────────────────────────────────────────

function FeedbackLoop({ active }: { active: boolean }) {
  const nodes = [
    { label: "Camera", icon: "📷", color: "blue" },
    { label: "Verify", icon: "🔍", color: "indigo" },
    { label: "Detect", icon: "⚠️", color: "orange" },
    { label: "Correct", icon: "⚡", color: "purple" },
    { label: "Robot", icon: "🤖", color: "emerald" },
  ];
  const colorMap: Record<string, { bg: string; text: string; border: string; arrow: string }> = {
    blue: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", arrow: "bg-blue-400" },
    indigo: { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200", arrow: "bg-indigo-400" },
    orange: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200", arrow: "bg-orange-400" },
    purple: { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200", arrow: "bg-purple-400" },
    emerald: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", arrow: "bg-emerald-400" },
  };
  return (
    <div className="bg-white rounded-2xl shadow-soft p-4">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Feedback Loop</h3>
        <span className={`w-1.5 h-1.5 rounded-full ${active ? "bg-orange-400 animate-pulse" : "bg-gray-300"}`} />
      </div>
      <div className="flex items-center justify-between">
        {nodes.map((node, i) => {
          const cfg = colorMap[node.color];
          return (
            <div key={node.label} className="flex items-center" style={{ flex: i < nodes.length - 1 ? "1 1 0" : "0 0 auto" }}>
              <motion.div
                animate={active ? { scale: [1, 1.06, 1], transition: { delay: i * 0.15, repeat: Infinity, repeatDelay: 0.9, duration: 0.4 } } : { scale: 1 }}
                className={`flex-shrink-0 flex flex-col items-center gap-1 px-2 py-2 rounded-xl border ${cfg.bg} ${cfg.border}`}
              >
                <span className="text-sm">{node.icon}</span>
                <span className={`text-[9px] font-semibold ${cfg.text}`}>{node.label}</span>
              </motion.div>
              {i < nodes.length - 1 && (
                <div className="flex-1 flex items-center justify-center">
                  <div className="flex items-center gap-0.5">
                    {[0, 1, 2].map((dot) => (
                      <motion.span
                        key={dot}
                        animate={active ? { opacity: [0.3, 1, 0.3], x: [0, 3, 0], transition: { delay: i * 0.15 + dot * 0.08, repeat: Infinity, repeatDelay: 0.8, duration: 0.35 } } : { opacity: 0.2 }}
                        className={`w-1 h-1 rounded-full ${cfg.arrow}`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-gray-400 text-center mt-3">
        {active ? "Failure detected — propagating correction to robot" : "Monitoring active — no failures in current sequence"}
      </p>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function LiveMonitor() {
  const [events, setEvents] = useState<WarehouseEvent[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [running, setRunning] = useState(true);
  const [failureCount, setFailureCount] = useState(0);
  const [missedCount, setMissedCount] = useState(0);
  const [successCount, setSuccessCount] = useState(0);
  const [lastFailure, setLastFailure] = useState(false);
  const [falseNegativeAlarm, setFalseNegativeAlarm] = useState(false);

  const [latencies, setLatencies] = useState<number[]>([]);
  const [mode, setMode] = useState<"standalone" | "wms">("standalone");
  const [alertEmail, setAlertEmail] = useState("");
  const [alertPhone, setAlertPhone] = useState("");
  const [savedEmail, setSavedEmail] = useState("");
  const [savedPhone, setSavedPhone] = useState("");
  const [showAlertSettings, setShowAlertSettings] = useState(false);
  const [showWebhook, setShowWebhook] = useState(false);
  const [lastWebhookPayload, setLastWebhookPayload] = useState<Record<string, unknown> | null>(null);
  const [webhookFired, setWebhookFired] = useState(false);
  const [displayedCost, setDisplayedCost] = useState(0);
  const [showReport, setShowReport] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [eventMeta, setEventMeta] = useState<Record<string, EventMeta>>({});

  const logRef = useRef<HTMLDivElement>(null);
  const allEventsRef = useRef<WarehouseEvent[]>([]);
  const allLatenciesRef = useRef<number[]>([]);
  const totalCostRef = useRef(0);
  const displayedCostRef = useRef(0);
  const savedEmailRef = useRef("");
  const savedPhoneRef = useRef("");
  const modeRef = useRef<"standalone" | "wms">("standalone");
  const runningRef = useRef(true);

  useEffect(() => { savedEmailRef.current = savedEmail; }, [savedEmail]);
  useEffect(() => { savedPhoneRef.current = savedPhone; }, [savedPhone]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { runningRef.current = running; }, [running]);

  // Auto-scroll log
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events]);

  const animateCost = useCallback((target: number) => {
    const from = displayedCostRef.current;
    animate(from, target, {
      duration: 0.7,
      ease: "easeOut",
      onUpdate: (v) => {
        displayedCostRef.current = Math.round(v);
        setDisplayedCost(Math.round(v));
      },
    });
    displayedCostRef.current = target;
  }, []);

  const sendAlerts = useCallback(
    async (
      event: WarehouseEvent,
      email: string,
      phone: string
    ) => {
      try {
        const res = await fetch("/api/alert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email || undefined,
            phone: phone || undefined,
            failureType: event.failureType,
            severity: event.severity,
            confidence: event.confidence,
            costImpact: event.costImpact,
            correction: event.correction,
            robotId: event.robotId,
          }),
        });
        const result = await res.json();
        setEventMeta((prev) => ({
          ...prev,
          [event.id]: {
            ...prev[event.id],
            emailSent: result.emailSent,
            smsSent: result.smsSent,
          },
        }));
      } catch {
        // Silent — don't break the monitor
      }
    },
    []
  );

  // Event tick loop
  useEffect(() => {
    if (!running) return;

    let timeoutId: ReturnType<typeof setTimeout>;

    const tick = () => {
      if (!runningRef.current) return;

      const latencyMs = 180 + Math.floor(Math.random() * 300); // 180–480ms
      const event = generateNextEvent();

      setAnalyzing(true);

      timeoutId = setTimeout(() => {
        if (!runningRef.current) return;
        setAnalyzing(false);

        // Attach latency to event meta
        setEventMeta((prev) => ({
          ...prev,
          [event.id]: { ...prev[event.id], latencyMs },
        }));

        setEvents((prev) => [...prev.slice(-80), event]);
        setLatencies((prev) => [...prev.slice(-9), latencyMs]);
        allEventsRef.current.push(event);
        allLatenciesRef.current.push(latencyMs);

        if (event.status === "failure") {
          if (event.missed) {
            setMissedCount((n) => n + 1);
            setFalseNegativeAlarm(true);
            setTimeout(() => setFalseNegativeAlarm(false), 5000);
          } else {
            setFailureCount((n) => n + 1);
            setLastFailure(true);
            setTimeout(() => setLastFailure(false), 2000);

            // Cost animation
            const newCost = totalCostRef.current + (event.costImpact ?? 0);
            totalCostRef.current = newCost;
            animateCost(newCost);

            // Webhook payload
            const payload: Record<string, unknown> = {
              event: "task_verification",
              version: "1.0",
              timestamp: new Date(event.timestamp).toISOString(),
              robot_id: event.robotId,
              status: "failure",
              failure_type: event.failureType,
              severity: event.severity,
              confidence: event.confidence,
              latency_ms: latencyMs,
              cost_impact_usd: event.costImpact,
              trigger_signal: event.triggerSignal,
              correction: event.correction,
              wms_acknowledged: modeRef.current === "wms",
            };
            setLastWebhookPayload(payload);
            setWebhookFired(true);
            setTimeout(() => setWebhookFired(false), 2000);

            // WMS badge
            if (modeRef.current === "wms") {
              setEventMeta((prev) => ({
                ...prev,
                [event.id]: { ...prev[event.id], wmsAcknowledged: true },
              }));
            }

            // Correction queue
            if (event.correction) {
              const c: Correction = {
                id: event.id,
                timestamp: event.timestamp,
                message: event.correction,
                failureType: event.failureType ?? "Unknown",
                sent: false,
              };
              setCorrections((prev) => [c, ...prev].slice(0, 20));
              setTimeout(() => {
                setCorrections((prev) =>
                  prev.map((x) => (x.id === c.id ? { ...x, sent: true } : x))
                );
              }, 1500);
            }

            // Alerts
            const em = savedEmailRef.current;
            const ph = savedPhoneRef.current;
            if (event.severity === "HIGH" && (em || ph)) {
              sendAlerts(event, em, ph);
            }
          }
        } else {
          setSuccessCount((n) => n + 1);
        }

        // Schedule next tick: keep total cycle ≈ 2200ms
        timeoutId = setTimeout(tick, Math.max(400, 2200 - latencyMs));
      }, latencyMs);
    };

    tick();
    return () => clearTimeout(timeoutId);
  }, [running, animateCost, sendAlerts]);

  const totalTasks = failureCount + missedCount + successCount;
  const detectionRate =
    failureCount + missedCount > 0
      ? (((failureCount / (failureCount + missedCount)) * 100)).toFixed(1)
      : "100.0";

  const avgLatency =
    latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : 0;

  return (
    <div className="w-full max-w-5xl mx-auto space-y-4">
      {/* False Negative Alarm Banner */}
      <AnimatePresence>
        {falseNegativeAlarm && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="bg-red-600 rounded-2xl px-4 py-3 flex items-center gap-3"
          >
            <span className="text-xl">🚨</span>
            <div>
              <p className="text-white text-xs font-bold tracking-wide">FALSE NEGATIVE DETECTED</p>
              <p className="text-red-200 text-[10px]">
                A real failure escaped without correction — this is the highest-priority event type
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Controls row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          {analyzing ? (
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          ) : (
            <span className={`w-2 h-2 rounded-full ${running ? "bg-emerald-400 animate-pulse" : "bg-gray-300"}`} />
          )}
          <span className="text-xs font-medium text-gray-600">
            {analyzing ? "Analyzing…" : running ? "Live monitoring active" : "Monitoring paused"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Mode toggle */}
          <div className="flex bg-gray-100 rounded-full p-0.5 text-[10px] font-semibold">
            {(["standalone", "wms"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1 rounded-full transition-all ${
                  mode === m ? "bg-white text-gray-800 shadow-sm" : "text-gray-500"
                }`}
              >
                {m === "standalone" ? "Standalone" : "WMS Connected"}
              </button>
            ))}
          </div>

          {/* Alert settings */}
          <button
            onClick={() => setShowAlertSettings((v) => !v)}
            className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
              savedEmail || savedPhone
                ? "border-blue-300 bg-blue-50 text-blue-600"
                : "border-gray-200 text-gray-500 hover:bg-gray-50"
            }`}
          >
            {savedEmail || savedPhone ? "🔔 Alerts On" : "🔔 Alerts"}
          </button>

          <button
            onClick={() => setRunning((v) => !v)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${
              running ? "bg-gray-900 text-white hover:bg-gray-800" : "bg-emerald-500 text-white hover:bg-emerald-600"
            }`}
          >
            {running ? "Pause" : "Resume"}
          </button>
        </div>
      </div>

      {/* Alert Settings panel */}
      <AnimatePresence>
        {showAlertSettings && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="bg-white rounded-2xl shadow-soft p-5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Alert Settings — HIGH Severity Only
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide block mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={alertEmail}
                    onChange={(e) => setAlertEmail(e.target.value)}
                    placeholder="alerts@yourcompany.com"
                    className="w-full text-xs text-gray-800 bg-gray-50 rounded-xl px-3 py-2 outline-none border border-gray-100 focus:border-blue-300 transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide block mb-1">
                    Phone (SMS)
                  </label>
                  <input
                    type="tel"
                    value={alertPhone}
                    onChange={(e) => setAlertPhone(e.target.value)}
                    placeholder="+1 (555) 000-0000"
                    className="w-full text-xs text-gray-800 bg-gray-50 rounded-xl px-3 py-2 outline-none border border-gray-100 focus:border-blue-300 transition-colors"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between mt-3">
                <p className="text-[10px] text-gray-400 leading-relaxed max-w-[260px]">
                  Requires <code className="bg-gray-100 px-1 rounded">RESEND_API_KEY</code> + Twilio keys in{" "}
                  <code className="bg-gray-100 px-1 rounded">.env.local</code>
                </p>
                <button
                  onClick={() => {
                    setSavedEmail(alertEmail);
                    setSavedPhone(alertPhone);
                    setShowAlertSettings(false);
                  }}
                  className="text-xs font-semibold bg-[#1e40af] text-white px-4 py-1.5 rounded-full hover:bg-[#1e3a8a] transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl shadow-soft p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{totalTasks}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">Tasks</p>
        </div>
        <div className="bg-white rounded-2xl shadow-soft p-4 text-center">
          <p className="text-2xl font-bold text-emerald-600">{successCount}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">Verified ✓</p>
        </div>
        <motion.div
          animate={lastFailure ? { scale: [1, 1.04, 1] } : { scale: 1 }}
          transition={{ duration: 0.3 }}
          className={`rounded-2xl shadow-soft p-4 text-center transition-colors ${lastFailure ? "bg-red-50" : "bg-white"}`}
        >
          <p className={`text-2xl font-bold ${lastFailure ? "text-red-600" : "text-red-500"}`}>
            {failureCount}
          </p>
          <p className="text-[11px] text-gray-400 mt-0.5">Caught</p>
        </motion.div>
        <div
          className={`rounded-2xl shadow-soft p-4 text-center ${
            parseFloat(detectionRate) < 95 ? "bg-red-50" : "bg-white"
          }`}
        >
          <p
            className={`text-2xl font-bold ${
              parseFloat(detectionRate) < 95 ? "text-red-600" : "text-emerald-600"
            }`}
          >
            {detectionRate}%
          </p>
          <p className="text-[11px] text-gray-400 mt-0.5">Accuracy</p>
          {missedCount > 0 && (
            <p className="text-[9px] font-bold text-red-500 mt-0.5">{missedCount} missed</p>
          )}
        </div>
      </div>

      {/* ROI bar */}
      <div className="bg-white rounded-2xl shadow-soft px-5 py-4 flex items-center justify-between">
        <div>
          <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">
            Cost Prevented This Session
          </p>
          <motion.p
            key={displayedCost}
            className="text-2xl font-bold text-emerald-600 mt-0.5 tabular-nums"
          >
            ${displayedCost.toLocaleString()}
          </motion.p>
        </div>
        <button
          onClick={() => setShowReport(true)}
          className="text-xs font-semibold bg-[#1e40af] text-white px-4 py-2 rounded-full hover:bg-[#1e3a8a] transition-colors flex items-center gap-1.5"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M3 2h10a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="white" strokeWidth="1.3" />
            <path d="M5 6h6M5 8.5h6M5 11h4" stroke="white" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          Monthly Report
        </button>
      </div>

      {/* Two-panel layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Task Feed */}
        <div className="lg:col-span-3 bg-white rounded-2xl shadow-soft flex flex-col" style={{ height: 420 }}>
          <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-50">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${analyzing ? "bg-amber-400 animate-pulse" : "bg-blue-400 animate-pulse"}`} />
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                {analyzing ? "Analyzing…" : "Warehouse Robot Feed"}
              </h3>
            </div>
            {/* Latency sparkline */}
            {latencies.length > 0 && (
              <div className="flex items-center gap-2">
                <LatencySparkline latencies={latencies} />
                <span
                  className={`text-[9px] font-mono font-semibold ${
                    avgLatency > 500 ? "text-red-500" : avgLatency > 300 ? "text-amber-500" : "text-gray-400"
                  }`}
                >
                  avg {avgLatency}ms
                </span>
              </div>
            )}
          </div>

          <div ref={logRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5 scrollbar-thin">
            <AnimatePresence>
              {events.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  meta={eventMeta[event.id]}
                  wmsMode={mode === "wms"}
                />
              ))}
            </AnimatePresence>
            {events.length === 0 && (
              <div className="flex items-center justify-center h-full">
                <p className="text-xs text-gray-300">
                  {analyzing ? "Analyzing first event…" : "Starting feed…"}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Correction Queue */}
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-soft flex flex-col" style={{ height: 420 }}>
          <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-50">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-orange-400" />
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Correction Queue</h3>
            </div>
            {corrections.length > 0 && (
              <span className="text-[10px] font-semibold text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded-full">
                {corrections.filter((c) => !c.sent).length} pending
              </span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            <AnimatePresence mode="popLayout">
              {corrections.map((c) => (
                <CorrectionItem key={c.id} c={c} />
              ))}
            </AnimatePresence>
            {corrections.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-2">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                  <path d="M9 12l2 2 4-4" stroke="#d1d5db" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="12" cy="12" r="9" stroke="#d1d5db" strokeWidth="1.5" />
                </svg>
                <p className="text-[11px] text-gray-300 text-center">No corrections queued</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Webhook Panel */}
      <div className="bg-white rounded-2xl shadow-soft overflow-hidden">
        <button
          onClick={() => setShowWebhook((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-left"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Webhook Output
            </span>
            <AnimatePresence>
              {webhookFired && (
                <motion.span
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-[9px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full"
                >
                  FIRED
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <div className="flex items-center gap-2">
            {lastWebhookPayload && (
              <span className="text-[10px] text-gray-400">Last payload ready</span>
            )}
            <motion.svg
              animate={{ rotate: showWebhook ? 180 : 0 }}
              transition={{ duration: 0.2 }}
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
            >
              <path d="M2 4l4 4 4-4" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </motion.svg>
          </div>
        </button>

        <AnimatePresence>
          {showWebhook && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden border-t border-gray-50"
            >
              <div className="p-4">
                {lastWebhookPayload ? (
                  <pre className="text-[10px] text-gray-600 bg-gray-50 rounded-xl p-3 overflow-x-auto leading-relaxed font-mono">
                    {JSON.stringify(lastWebhookPayload, null, 2)}
                  </pre>
                ) : (
                  <p className="text-xs text-gray-400 text-center py-4">
                    Waiting for first failure event…
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Feedback Loop */}
      <FeedbackLoop active={lastFailure} />

      {/* Monthly Report Modal */}
      <AnimatePresence>
        {showReport && (
          <MonthlyReportModal
            allEvents={allEventsRef.current}
            allLatencies={allLatenciesRef.current}
            totalCost={totalCostRef.current}
            missedCount={missedCount}
            onClose={() => setShowReport(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
