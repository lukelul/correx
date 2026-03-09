"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import UploadZone from "@/components/UploadZone";
import ProcessingAnimation from "@/components/ProcessingAnimation";
import VerificationResult from "@/components/VerificationResult";
import FrameStrip from "@/components/FrameStrip";
import FrameSettings from "@/components/FrameSettings";
import PrivacyShieldVideo from "@/components/PrivacyShieldVideo";
import LiveMonitor from "@/components/LiveMonitor";
import VerificationHistory from "@/components/VerificationHistory";
import TrainingClips from "@/components/TrainingClips";
import CameraCapture from "@/components/CameraCapture";
import { extractFrames, getVideoDuration, type ExtractedFrame, type FrameMode } from "@/lib/extractFrames";
import { saveVerification } from "@/lib/historyStore";
import SplashScreen from "@/components/SplashScreen";
import type { VerificationResult as VResult } from "@/app/api/verify/route";

type Stage = "idle" | "extracting" | "processing" | "result" | "error";
type Tab = "verify" | "monitor" | "training" | "history";

const EXAMPLE_TASKS = [
  "Bring a cup of coffee to the desk",
  "Cook pasta and plate it",
  "Pick up and stack the books",
  "Pour water into the glass",
];

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  {
    id: "verify",
    label: "Verify",
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path
          d="M3 8l3.5 3.5L13 4"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: "monitor",
    label: "Live Monitor",
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="8" cy="8" r="2" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "training",
    label: "Training",
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path
          d="M2 12L6 4l4 6 2-3 2 5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: "history",
    label: "History",
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M8 5.5v2.8l1.8 1.8"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];

const HOME_MODES: { id: Tab; label: string; description: string; icon: React.ReactNode }[] = [
  {
    id: "verify",
    label: "Verify",
    description: "PASS/FAIL + root cause + corrective distances",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M10 2L3 5.5v5.25c0 4.375 3.208 8.458 7 9.583 3.792-1.125 7-5.208 7-9.583V5.5L10 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        <path d="M7 10l2.2 2.2 3.8-4.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    id: "monitor",
    label: "Live Monitor",
    description: "Live feed with real-time correction queue",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <polyline points="2,10 5,10 6.5,6 8,14 9.5,10 11,10 12.5,7 14,10 18,10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    id: "training",
    label: "Training",
    description: "Build AI training datasets from clips",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M2 7l8 5 8-5M2 12l8 5 8-5M10 2l8 5-8 5L2 7l8-5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    id: "history",
    label: "History",
    description: "Browse past verification results",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M10 6v4.5l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
];

export default function Home() {
  const [splashDone, setSplashDone] = useState(false);
  const [showHome, setShowHome] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("verify");

  // Verify tab state
  const [stage, setStage] = useState<Stage>("idle");
  const [task, setTask] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isVideo, setIsVideo] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [frameMode, setFrameMode] = useState<FrameMode>({ type: "count", count: 6 });
  const [frames, setFrames] = useState<ExtractedFrame[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [processingStep, setProcessingStep] = useState(0);
  const [result, setResult] = useState<VResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState("");
  const [refFile, setRefFile] = useState<File | null>(null);
  const [refPreview, setRefPreview] = useState<string | null>(null);
  const [showContext, setShowContext] = useState(false);
  const [refDragging, setRefDragging] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [verifyLatencyMs, setVerifyLatencyMs] = useState<number | null>(null);

  const runExtraction = async (f: File, mode: FrameMode) => {
    setIsExtracting(true);
    setFrames([]);
    try {
      const extracted = await extractFrames(f, mode);
      setFrames(extracted);
    } catch (err) {
      console.error("Frame extraction failed:", err);
    } finally {
      setIsExtracting(false);
    }
  };

  const handleFileSelect = async (f: File, p: string) => {
    setFile(f);
    setPreview(p);
    setFrames([]);

    if (f.type.startsWith("video/")) {
      setIsVideo(true);
      try {
        const dur = await getVideoDuration(f);
        setVideoDuration(dur);
        const autoMode: FrameMode =
          dur > 30
            ? { type: "interval", intervalSec: Math.max(2, Math.round(dur / 10)) }
            : { type: "count", count: 6 };
        setFrameMode(autoMode);
        await runExtraction(f, autoMode);
      } catch {
        await runExtraction(f, frameMode);
      }
    } else {
      setIsVideo(false);
      setVideoDuration(0);
    }
  };

  const handleFrameModeChange = async (newMode: FrameMode) => {
    setFrameMode(newMode);
    if (file && isVideo) {
      await runExtraction(file, newMode);
    }
  };

  const handleVerify = async () => {
    if (!file || !task.trim()) return;
    if (isVideo && frames.length === 0) return;

    setStage("processing");
    setProcessingStep(0);
    setResult(null);
    setError(null);
    setVerifyLatencyMs(null);

    const stepInterval = setInterval(() => {
      setProcessingStep((s) => Math.min(s + 1, 4));
    }, 900);

    const verifyStart = Date.now();

    try {
      const formData = new FormData();
      formData.append("task", task.trim());
      if (context.trim()) formData.append("context", context.trim());
      if (refFile) formData.append("referenceImage", refFile);

      if (isVideo && frames.length > 0) {
        const keptFrames = frames.filter((f) => f.kept);
        formData.append("frameCount", String(keptFrames.length));
        keptFrames.forEach((frame, i) => {
          formData.append(`frame_${i}`, frame.dataUrl);
          formData.append(`frame_${i}_ts`, String(frame.timestampSec));
        });
      } else {
        formData.append("file", file);
      }

      const res = await fetch("/api/verify", {
        method: "POST",
        body: formData,
      });

      clearInterval(stepInterval);
      setProcessingStep(5);
      setVerifyLatencyMs(Date.now() - verifyStart);

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Verification failed");
      }

      await new Promise((r) => setTimeout(r, 400));

      // Save to history with thumbnail
      const thumbnail = isVideo
        ? frames.find((f) => f.kept)?.dataUrl
        : preview ?? undefined;
      saveVerification(task.trim(), data, thumbnail);

      setResult(data);
      setStage("result");
    } catch (err: unknown) {
      clearInterval(stepInterval);
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      setStage("error");
    }
  };

  const handleReset = () => {
    setStage("idle");
    setTask("");
    setFile(null);
    setPreview(null);
    setIsVideo(false);
    setVideoDuration(0);
    setFrameMode({ type: "count", count: 6 });
    setFrames([]);
    setIsExtracting(false);
    setProcessingStep(0);
    setResult(null);
    setError(null);
    setContext("");
    setRefFile(null);
    setRefPreview(null);
    setShowContext(false);
    setShowCamera(false);
    setVerifyLatencyMs(null);
  };

  const keptFrames = frames.filter((f) => f.kept);
  const canVerify =
    file !== null &&
    task.trim().length > 0 &&
    !isExtracting &&
    (isVideo ? keptFrames.length > 0 : true);

  if (showHome) {
    return (
      <div className="min-h-screen bg-[#f8f8f7] flex flex-col">
        {!splashDone && <SplashScreen onDone={() => setSplashDone(true)} />}

        {/*
          The h1 lives here always — invisible behind the splash.
          When alone in the flex-centered container it sits at screen center.
          When splashDone fires: h1 becomes instantly visible + cards mount below it.
          The flex layout shift pushes h1 upward; Framer Motion `layout` animates that move.
        */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-16">
          <div className="text-center">
            <motion.h1
              layout
              className="font-bold text-gray-900 mx-auto"
              style={{
                fontFamily: "var(--font-satisfy)",
                fontSize: "3rem",
                display: "block",
                width: "fit-content",
                marginBottom: "0.5rem",
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: splashDone ? 1 : 0 }}
              transition={{
                opacity: { duration: 0 },
                layout: { duration: 0.65, ease: [0.25, 0.46, 0.45, 0.94] },
              }}
            >
              Correx
            </motion.h1>

            {splashDone && (
              <motion.p
                className="text-sm text-gray-400"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.45 }}
              >
                Verify outcomes · diagnose failures · correct with precision
              </motion.p>
            )}
          </div>

          {/* Mode cards — mounting these shifts the h1 upward */}
          {splashDone && (
            <div className="mt-12 grid grid-cols-2 gap-3 w-full max-w-sm">
              {HOME_MODES.map((mode, i) => (
                <motion.button
                  key={mode.id}
                  onClick={() => { setShowHome(false); setActiveTab(mode.id); }}
                  className="bg-white rounded-2xl p-5 text-left shadow-soft"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.1 + i * 0.07 }}
                  whileHover={{ y: -3, transition: { duration: 0.15 } }}
                  whileTap={{ scale: 0.97 }}
                >
                  <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center mb-3 text-blue-600">
                    {mode.icon}
                  </div>
                  <div className="text-sm font-semibold text-gray-900">{mode.label}</div>
                  <div className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">{mode.description}</div>
                </motion.button>
              ))}
            </div>
          )}
        </div>

        <footer className="pb-8 text-center">
          <p className="text-xs text-gray-300">Correx — Robotic Safety Compliance Layer</p>
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f8f7] flex flex-col">
      {/* Header */}
      <header className="pt-8 pb-6 px-6 text-center relative">
        <button
          onClick={() => setShowHome(true)}
          className="absolute left-5 top-8 flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M8.5 3L5 7l3.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Home
        </button>
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          <div className="inline-flex items-center gap-2 bg-white rounded-full px-4 py-1.5 shadow-soft mb-4">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            <span className="text-xs font-medium text-gray-500 tracking-wide">
              Safety Compliance Layer
            </span>
          </div>
          <h1 className="text-5xl font-bold text-gray-900" style={{ fontFamily: "var(--font-satisfy)" }}>
            Correx
          </h1>
          <p className="text-sm text-gray-400 mt-2 max-w-xs mx-auto leading-relaxed">
            Post-execution verification · root cause reasoning · corrective motion sequences
          </p>
        </motion.div>
      </header>

      {/* Tab nav */}
      <div className="flex justify-center px-6 mb-6">
        <div className="bg-white rounded-2xl shadow-soft p-1 flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all duration-200 ${
                activeTab === tab.id
                  ? "bg-[#1e40af] text-white shadow-sm"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
              }`}
            >
              {tab.icon}
              {tab.label}
              {tab.id === "monitor" && activeTab !== "monitor" && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <main className="flex-1 px-6 pb-16">
        <>
          {/* ── VERIFY TAB ──────────────────────────────────────────── */}
          <div className={`flex flex-col items-center ${activeTab !== "verify" ? "hidden" : ""}`}>
              <div className="w-full max-w-md">
                <AnimatePresence mode="wait">
                  {stage === "processing" ? (
                    <ProcessingAnimation key="processing" currentStep={processingStep} />
                  ) : stage === "result" && result ? (
                    <VerificationResult key="result" result={result} onReset={handleReset} latencyMs={verifyLatencyMs} />
                  ) : stage === "error" ? (
                    <motion.div
                      key="error"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -12 }}
                      className="bg-white rounded-2xl shadow-soft p-8 text-center"
                    >
                      <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                          <path
                            d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                            stroke="#ef4444"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </div>
                      <h3 className="text-sm font-semibold text-gray-800 mb-1">
                        Verification Failed
                      </h3>
                      <p className="text-xs text-gray-400 mb-5 leading-relaxed">{error}</p>
                      <button
                        onClick={handleReset}
                        className="text-sm font-medium text-blue-500 hover:text-blue-600 transition-colors"
                      >
                        Try again
                      </button>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="idle"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -12 }}
                      transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
                      className="space-y-4"
                    >
                      {/* Upload */}
                      <div className="bg-white rounded-2xl shadow-soft p-5">
                        <div className="flex items-center justify-between mb-3">
                          <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                            Task Output
                          </label>
                          {isVideo && keptFrames.length > 0 && (
                            <motion.span
                              initial={{ opacity: 0, scale: 0.8 }}
                              animate={{ opacity: 1, scale: 1 }}
                              className="inline-flex items-center gap-1 text-xs text-blue-500 font-medium bg-blue-50 px-2 py-0.5 rounded-full"
                            >
                              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                                <rect x="1" y="2" width="10" height="8" rx="1.5" stroke="#3b82f6" strokeWidth="1.2" />
                                <path d="M4.5 4.5l3 1.5-3 1.5V4.5z" fill="#3b82f6" />
                              </svg>
                              {keptFrames.length} unique frames
                            </motion.span>
                          )}
                        </div>

                        {showCamera && !preview && (
                          <div className="mb-3">
                            <CameraCapture
                              onCapture={(f, p) => {
                                setShowCamera(false);
                                handleFileSelect(f, p);
                              }}
                              onClose={() => setShowCamera(false)}
                            />
                          </div>
                        )}

                        {preview ? (
                          <div>
                            <div className="relative rounded-xl overflow-hidden bg-gray-50">
                              {isVideo ? (
                                <PrivacyShieldVideo src={preview} />
                              ) : (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={preview}
                                  alt="Uploaded"
                                  className="w-full max-h-48 object-cover"
                                />
                              )}
                              <button
                                onClick={() => {
                                  setFile(null);
                                  setPreview(null);
                                  setFrames([]);
                                  setIsVideo(false);
                                  setVideoDuration(0);
                                  setFrameMode({ type: "count", count: 6 });
                                }}
                                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center transition-colors z-10"
                              >
                                <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                                  <path d="M2 2l8 8M10 2L2 10" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                                </svg>
                              </button>
                              {!isVideo && (
                                <div className="absolute bottom-2 left-2 bg-black/40 rounded-lg px-2 py-1">
                                  <span className="text-white text-xs font-medium truncate max-w-[200px] block">
                                    {file?.name}
                                  </span>
                                </div>
                              )}
                            </div>

                            {isVideo && (
                              <>
                                <FrameStrip frames={frames} isExtracting={isExtracting} />
                                <FrameSettings
                                  mode={frameMode}
                                  onChange={handleFrameModeChange}
                                  videoDuration={videoDuration}
                                  frames={frames}
                                  disabled={isExtracting}
                                />
                              </>
                            )}
                          </div>
                        ) : !showCamera ? (
                          <div className="space-y-2">
                            <UploadZone onFileSelect={handleFileSelect} />
                            <button
                              onClick={() => setShowCamera(true)}
                              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold text-gray-500 hover:text-gray-700 hover:bg-gray-50 border border-dashed border-gray-200 hover:border-gray-300 transition-all"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                                <circle cx="12" cy="13" r="4" stroke="currentColor" strokeWidth="1.6"/>
                              </svg>
                              Use webcam or phone camera
                            </button>
                          </div>
                        ) : null}
                      </div>

                      {/* Task description */}
                      <div className="bg-white rounded-2xl shadow-soft p-5">
                        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-3">
                          Task Description
                        </label>
                        <textarea
                          value={task}
                          onChange={(e) => setTask(e.target.value)}
                          placeholder="Describe what the robot was supposed to do..."
                          className="w-full text-sm text-gray-800 placeholder-gray-300 resize-none outline-none leading-relaxed bg-transparent"
                          rows={3}
                        />
                        <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-gray-50">
                          {EXAMPLE_TASKS.map((ex) => (
                            <button
                              key={ex}
                              onClick={() => setTask(ex)}
                              className="text-xs text-gray-400 hover:text-gray-600 bg-gray-50 hover:bg-gray-100 px-2.5 py-1 rounded-full transition-colors"
                            >
                              {ex}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Context & Reference — collapsible */}
                      <div className="bg-white rounded-2xl shadow-soft overflow-hidden">
                        <button
                          onClick={() => setShowContext((v) => !v)}
                          className="w-full flex items-center justify-between px-5 py-4 text-left"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                              Context & Reference
                            </span>
                            {(context.trim() || refFile) && (
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                            )}
                          </div>
                          <motion.svg
                            animate={{ rotate: showContext ? 180 : 0 }}
                            transition={{ duration: 0.2 }}
                            width="14"
                            height="14"
                            viewBox="0 0 14 14"
                            fill="none"
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

                        <AnimatePresence initial={false}>
                          {showContext && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
                              className="overflow-hidden"
                            >
                              <div className="px-5 pb-5 space-y-4 border-t border-gray-50 pt-4">
                                <div>
                                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-2">
                                    Appliance / Environment Notes
                                  </label>
                                  <textarea
                                    value={context}
                                    onChange={(e) => setContext(e.target.value)}
                                    placeholder={`Describe quirks the AI wouldn't know, e.g.:\n"On this stove, knob pointing straight up = OFF."`}
                                    className="w-full text-sm text-gray-700 placeholder-gray-300 resize-none outline-none leading-relaxed bg-gray-50 rounded-xl px-3 py-2.5"
                                    rows={4}
                                  />
                                  <p className="text-[11px] text-gray-300 mt-1.5 leading-relaxed">
                                    Sent as ground truth — the model trusts this over its own assumptions.
                                  </p>
                                </div>

                                <div>
                                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-2">
                                    Reference Image{" "}
                                    <span className="text-gray-300 normal-case font-normal">
                                      (optional — known-correct state)
                                    </span>
                                  </label>
                                  {refPreview ? (
                                    <div className="relative rounded-xl overflow-hidden bg-gray-50">
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img
                                        src={refPreview}
                                        alt="Reference"
                                        className="w-full max-h-32 object-cover"
                                      />
                                      <button
                                        onClick={() => {
                                          setRefFile(null);
                                          setRefPreview(null);
                                        }}
                                        className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center transition-colors"
                                      >
                                        <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                                          <path
                                            d="M1.5 1.5l7 7M8.5 1.5l-7 7"
                                            stroke="white"
                                            strokeWidth="1.5"
                                            strokeLinecap="round"
                                          />
                                        </svg>
                                      </button>
                                      <div className="absolute bottom-2 left-2 bg-emerald-500/80 rounded-lg px-2 py-0.5">
                                        <span className="text-white text-[10px] font-semibold">
                                          Reference
                                        </span>
                                      </div>
                                    </div>
                                  ) : (
                                    <label
                                      htmlFor="ref-upload"
                                      className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${refDragging ? "border-blue-400 bg-blue-50/60" : "border-gray-200 hover:border-gray-300 bg-gray-50/50"}`}
                                      onDragOver={(e) => { e.preventDefault(); setRefDragging(true); }}
                                      onDragLeave={() => setRefDragging(false)}
                                      onDrop={(e) => {
                                        e.preventDefault();
                                        setRefDragging(false);
                                        const f = e.dataTransfer.files[0];
                                        if (!f || !f.type.startsWith("image/")) return;
                                        setRefFile(f);
                                        const reader = new FileReader();
                                        reader.onload = (ev) => setRefPreview(ev.target?.result as string);
                                        reader.readAsDataURL(f);
                                      }}
                                    >
                                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${refDragging ? "bg-blue-100" : "bg-gray-100"}`}>
                                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                                          <path
                                            d="M8 3v10M3 8h10"
                                            stroke={refDragging ? "#3b82f6" : "#9ca3af"}
                                            strokeWidth="1.5"
                                            strokeLinecap="round"
                                          />
                                        </svg>
                                      </div>
                                      <div>
                                        <p className={`text-xs font-medium transition-colors ${refDragging ? "text-blue-600" : "text-gray-500"}`}>
                                          {refDragging ? "Drop image here" : "Upload reference image"}
                                        </p>
                                        <p className="text-[11px] text-gray-300">
                                          A photo of the correct/safe state
                                        </p>
                                      </div>
                                      <input
                                        id="ref-upload"
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={(e) => {
                                          const f = e.target.files?.[0];
                                          if (!f) return;
                                          setRefFile(f);
                                          const reader = new FileReader();
                                          reader.onload = (ev) =>
                                            setRefPreview(ev.target?.result as string);
                                          reader.readAsDataURL(f);
                                        }}
                                      />
                                    </label>
                                  )}
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>

                      {/* Verify button */}
                      <motion.button
                        onClick={handleVerify}
                        disabled={!canVerify}
                        className={`w-full py-3.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                          canVerify
                            ? "bg-[#1e40af] text-white shadow-soft hover:bg-[#1e3a8a] hover:shadow-soft-lg"
                            : "bg-gray-100 text-gray-300 cursor-not-allowed"
                        }`}
                        whileHover={canVerify ? { scale: 1.01 } : {}}
                        whileTap={canVerify ? { scale: 0.99 } : {}}
                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                      >
                        {isExtracting ? "Extracting frames…" : "Run Verification"}
                      </motion.button>

                      <p className="text-center text-xs text-gray-300 leading-relaxed">
                        Requires{" "}
                        <code className="bg-gray-100 text-gray-400 px-1 py-0.5 rounded text-[11px]">
                          OPENAI_API_KEY
                        </code>{" "}
                        in{" "}
                        <code className="bg-gray-100 text-gray-400 px-1 py-0.5 rounded text-[11px]">
                          .env.local
                        </code>
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

          {/* ── LIVE MONITOR TAB ─────────────────────────────────────── */}
          <div className={activeTab !== "monitor" ? "hidden" : ""}>
            <LiveMonitor />
          </div>

          {/* ── TRAINING TAB ─────────────────────────────────────────── */}
          <div className={activeTab !== "training" ? "hidden" : ""}>
            <TrainingClips />
          </div>

          {/* ── HISTORY TAB ──────────────────────────────────────────── */}
          <div className={activeTab !== "history" ? "hidden" : ""}>
            <VerificationHistory />
          </div>
        </>
      </main>

      <footer className="pb-8 text-center">
        <p className="text-xs text-gray-300">
          Correx — Robotic Safety Compliance Layer
        </p>
      </footer>
    </div>
  );
}
