"use client";

import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { extractFrames, type FrameMode } from "@/lib/extractFrames";
import type { VerificationResult } from "@/app/api/verify/route";

// ── On-device TF.js inference ────────────────────────────────────────────────
const CORREX_CLASSES = ["success", "wrong_item", "drop_detected", "placement_miss", "grip_failure"] as const;
const IMG_MEAN = [0.485, 0.456, 0.406];
const IMG_STD  = [0.229, 0.224, 0.225];
const SEQ_LEN  = 16;
const IMG_SIZE = 224;

async function ensureTf(): Promise<void> {
  if ((window as any).tf) return;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js";
    s.onload = () => resolve();
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function videoFramesToPixels(file: File): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.src = url;
    video.muted = true;
    video.onloadedmetadata = async () => {
      const duration = video.duration;
      const canvas = document.createElement("canvas");
      canvas.width = IMG_SIZE;
      canvas.height = IMG_SIZE;
      const ctx = canvas.getContext("2d")!;
      const allPixels: number[] = [];

      for (let i = 0; i < SEQ_LEN; i++) {
        const t = (i / (SEQ_LEN - 1)) * duration;
        await new Promise<void>((res) => {
          video.currentTime = Math.min(t, duration - 0.01);
          video.onseeked = () => res();
        });
        ctx.drawImage(video, 0, 0, IMG_SIZE, IMG_SIZE);
        const px = ctx.getImageData(0, 0, IMG_SIZE, IMG_SIZE).data;
        for (let p = 0; p < IMG_SIZE * IMG_SIZE; p++) {
          const r = (px[p * 4]     / 255 - IMG_MEAN[0]) / IMG_STD[0];
          const g = (px[p * 4 + 1] / 255 - IMG_MEAN[1]) / IMG_STD[1];
          const b = (px[p * 4 + 2] / 255 - IMG_MEAN[2]) / IMG_STD[2];
          allPixels.push(r, g, b);
        }
      }
      URL.revokeObjectURL(url);
      resolve(allPixels);
    };
    video.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Video load error")); };
  });
}

async function imageFrameToPixels(file: File): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = IMG_SIZE;
      canvas.height = IMG_SIZE;
      const ctx = canvas.getContext("2d")!;
      const allPixels: number[] = [];
      for (let i = 0; i < SEQ_LEN; i++) {
        ctx.drawImage(img, 0, 0, IMG_SIZE, IMG_SIZE);
        const px = ctx.getImageData(0, 0, IMG_SIZE, IMG_SIZE).data;
        for (let p = 0; p < IMG_SIZE * IMG_SIZE; p++) {
          const r = (px[p * 4]     / 255 - IMG_MEAN[0]) / IMG_STD[0];
          const g = (px[p * 4 + 1] / 255 - IMG_MEAN[1]) / IMG_STD[1];
          const b = (px[p * 4 + 2] / 255 - IMG_MEAN[2]) / IMG_STD[2];
          allPixels.push(r, g, b);
        }
      }
      URL.revokeObjectURL(url);
      resolve(allPixels);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image load error")); };
    img.src = url;
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedModel: any = null;

async function runCorrExInference(file: File): Promise<VerificationResult> {
  await ensureTf();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (window as any).tf;
  if (!tf) throw new Error("TF.js failed to load");

  if (!cachedModel) {
    cachedModel = await tf.loadLayersModel("/model/model.json");
  }

  const pixels = file.type.startsWith("video/")
    ? await videoFramesToPixels(file)
    : await imageFrameToPixels(file);

  const tensor = tf.tensor(pixels, [1, SEQ_LEN, IMG_SIZE, IMG_SIZE, 3]);
  const probs = await cachedModel.predict(tensor).data() as Float32Array;

  const topIdx = probs.indexOf(Math.max(...Array.from(probs)));
  const topClass = CORREX_CLASSES[topIdx];
  const topConf = Math.round(probs[topIdx] * 100);
  const isSuccess = topClass === "success";

  const classLabels: Record<string, string> = {
    success: "Task Completed",
    wrong_item: "Wrong Item Picked",
    drop_detected: "Item Dropped",
    placement_miss: "Placement Miss",
    grip_failure: "Grip Failure",
  };

  return {
    verdict: isSuccess ? "PASS" : "FAIL",
    confidence: topConf,
    summary: `On-device CorrexVerifier: ${classLabels[topClass]} (${topConf}% confidence). ${
      isSuccess ? "No failure patterns detected." : `Detected failure: ${classLabels[topClass]}.`
    }`,
    checks: CORREX_CLASSES.slice(1).map((cls) => ({
      label: classLabels[cls],
      status: topClass === cls ? "fail" : "pass",
      detail: `${Math.round(probs[CORREX_CLASSES.indexOf(cls)] * 100)}% probability`,
    })),
    risk_level: isSuccess ? "low" : topConf > 80 ? "high" : "medium",
    recommendation: isSuccess
      ? "Task verified on-device. No intervention required."
      : `On-device model flagged: ${classLabels[topClass]}. Review the clip.`,
  };
}

interface TrainingClip {
  id: string;
  file: File;
  thumbnailDataUrl: string;
  task: string;
  status: "pending" | "processing" | "verified" | "error";
  verdict?: "PASS" | "FAIL";
  result?: VerificationResult;
  frameCount?: number;
  errorMsg?: string;
  manualVerdict?: "PASS" | "FAIL";
  correctionNote?: string;
}

function StatusBadge({ status, verdict, manualVerdict }: Pick<TrainingClip, "status" | "verdict" | "manualVerdict">) {
  if (status === "pending")
    return (
      <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
        Pending
      </span>
    );
  if (status === "processing")
    return (
      <span className="text-[10px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
        Processing
      </span>
    );
  if (status === "error")
    return (
      <span className="text-[10px] font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
        Error
      </span>
    );
  if (status === "verified") {
    const effective = manualVerdict ?? verdict;
    const corrected = !!manualVerdict;
    return (
      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 ${
        effective === "PASS"
          ? corrected ? "text-amber-700 bg-amber-50" : "text-emerald-700 bg-emerald-50"
          : corrected ? "text-amber-700 bg-amber-50" : "text-red-700 bg-red-50"
      }`}>
        {corrected && (
          <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
            <path d="M7 1.5l1.5 1.5L3 8.5H1.5V7L7 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
          </svg>
        )}
        {effective}
      </span>
    );
  }
  return null;
}

async function extractThumbnail(file: File): Promise<string> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    const url = URL.createObjectURL(file);
    video.src = url;
    video.currentTime = 0.5;
    video.onseeked = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 120;
      canvas.height = 80;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.drawImage(video, 0, 0, 120, 80);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.7));
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      // For images, just read directly
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string ?? "");
      reader.readAsDataURL(file);
    };
  });
}

async function verifyClip(clip: TrainingClip, correctionContext?: string): Promise<VerificationResult> {
  const formData = new FormData();
  formData.append("task", clip.task.trim());
  if (correctionContext) formData.append("context", correctionContext);

  const isVideo = clip.file.type.startsWith("video/");

  if (isVideo) {
    const mode: FrameMode = { type: "count", count: 5 };
    const frames = await extractFrames(clip.file, mode);
    const kept = frames.filter((f) => f.kept);
    formData.append("frameCount", String(kept.length));
    kept.forEach((f, i) => {
      formData.append(`frame_${i}`, f.dataUrl);
      formData.append(`frame_${i}_ts`, String(f.timestampSec));
    });
  } else {
    formData.append("file", clip.file);
  }

  const res = await fetch("/api/verify", { method: "POST", body: formData });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Verification failed");
  return data as VerificationResult;
}

function exportDataset(clips: TrainingClip[]) {
  const verified = clips.filter((c) => c.status === "verified" && c.result);
  const lines = verified.map((c) =>
    JSON.stringify({
      task: c.task,
      verdict: c.manualVerdict ?? c.verdict,
      ai_verdict: c.verdict,
      ...(c.manualVerdict ? { corrected: true, correction_note: c.correctionNote ?? "" } : {}),
      confidence: c.result!.confidence,
      risk_level: c.result!.risk_level,
      checks: c.result!.checks,
      summary: c.result!.summary,
      recommendation: c.result!.recommendation,
      source_file: c.file.name,
      frames_sampled: c.frameCount ?? 1,
    })
  );
  const blob = new Blob([lines.join("\n")], { type: "application/jsonl" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rtv_training_dataset_${Date.now()}.jsonl`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function TrainingClips() {
  const [clips, setClips] = useState<TrainingClip[]>([]);
  const [tuning, setTuning] = useState(false);
  const [tuneProgress, setTuneProgress] = useState(0);
  const [tuneDone, setTuneDone] = useState(false);
  const [localRunning, setLocalRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const updateManualVerdict = (id: string, v: "PASS" | "FAIL") =>
    setClips((prev) => prev.map((c) => (c.id === id ? { ...c, manualVerdict: v } : c)));

  const updateCorrectionNote = (id: string, note: string) =>
    setClips((prev) => prev.map((c) => (c.id === id ? { ...c, correctionNote: note } : c)));

  const handleFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    const mediaFiles = arr.filter(
      (f) => f.type.startsWith("video/") || f.type.startsWith("image/")
    );

    for (const file of mediaFiles) {
      const id = Math.random().toString(36).slice(2, 10);
      const thumbnail = await extractThumbnail(file);
      const clip: TrainingClip = {
        id,
        file,
        thumbnailDataUrl: thumbnail,
        task: "",
        status: "pending",
      };
      setClips((prev) => [...prev, clip]);
    }
  };

  const updateTask = (id: string, task: string) => {
    setClips((prev) => prev.map((c) => (c.id === id ? { ...c, task } : c)));
  };

  const removeClip = (id: string) => {
    setClips((prev) => prev.filter((c) => c.id !== id));
  };

  const processAll = async () => {
    const pending = clips.filter(
      (c) => c.status === "pending" && c.task.trim()
    );

    // Build correction context from all human-corrected clips so the model
    // can calibrate its assessment based on expert feedback this session.
    const corrected = clips.filter((c) => c.status === "verified" && c.manualVerdict);
    const correctionContext = corrected.length > 0
      ? `Human expert corrections from previous assessments in this session:\n${corrected
          .map((c) =>
            `- Task "${c.task}": AI initially said ${c.verdict}, human expert corrected to ${c.manualVerdict}${c.correctionNote ? ` — reason: "${c.correctionNote}"` : ""}. Prioritise the human verdict.`
          )
          .join("\n")}\n\nApply these corrections when assessing similar tasks.`
      : undefined;

    for (const clip of pending) {
      setClips((prev) =>
        prev.map((c) =>
          c.id === clip.id ? { ...c, status: "processing" } : c
        )
      );

      try {
        const result = await verifyClip(clip, correctionContext);
        setClips((prev) =>
          prev.map((c) =>
            c.id === clip.id
              ? {
                  ...c,
                  status: "verified",
                  verdict: result.verdict,
                  result,
                }
              : c
          )
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setClips((prev) =>
          prev.map((c) =>
            c.id === clip.id ? { ...c, status: "error", errorMsg: msg } : c
          )
        );
      }
    }
  };

  const runAllLocal = async () => {
    if (localRunning) return;
    const pending = clips.filter((c) => c.status === "pending");
    if (!pending.length) return;
    setLocalRunning(true);
    for (const clip of pending) {
      setClips((prev) => prev.map((c) => c.id === clip.id ? { ...c, status: "processing" } : c));
      try {
        const result = await runCorrExInference(clip.file);
        setClips((prev) => prev.map((c) =>
          c.id === clip.id ? { ...c, status: "verified", verdict: result.verdict, result } : c
        ));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Local model error";
        setClips((prev) => prev.map((c) => c.id === clip.id ? { ...c, status: "error", errorMsg: msg } : c));
      }
    }
    setLocalRunning(false);
  };

  const simulateFineTune = async () => {
    if (tuning) return;
    setTuning(true);
    setTuneProgress(0);
    setTuneDone(false);

    const steps = [
      { label: "Preparing dataset…", pct: 12 },
      { label: "Tokenizing frames…", pct: 25 },
      { label: "Initializing fine-tune job…", pct: 38 },
      { label: "Epoch 1/3 — loss: 0.847", pct: 52 },
      { label: "Epoch 2/3 — loss: 0.613", pct: 68 },
      { label: "Epoch 3/3 — loss: 0.421", pct: 84 },
      { label: "Saving checkpoint…", pct: 94 },
      { label: "Model updated ✓", pct: 100 },
    ];

    for (const step of steps) {
      await new Promise((r) => setTimeout(r, 600 + Math.random() * 400));
      setTuneProgress(step.pct);
    }

    setTuneDone(true);
    setTuning(false);
  };

  const verified = clips.filter((c) => c.status === "verified");
  const passCount = verified.filter((c) => c.verdict === "PASS").length;
  const failCount = verified.filter((c) => c.verdict === "FAIL").length;
  const pendingWithTask = clips.filter(
    (c) => c.status === "pending" && c.task.trim()
  );

  const canProcess = pendingWithTask.length > 0;
  const canExport = verified.length > 0;
  const canFineTune = verified.length >= 2;

  return (
    <div className="w-full max-w-2xl mx-auto space-y-4">
      {/* Upload drop zone */}
      <div
        className={`rounded-2xl shadow-soft p-6 border-2 transition-colors duration-150 ${isDragging ? "border-blue-400 bg-blue-50/60" : "border-transparent bg-white"}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
        }}
      >
        <div className="text-center">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-3">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 16V8m0 0l-3 3m3-3l3 3"
                stroke="#3b82f6"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <rect x="3" y="3" width="18" height="18" rx="4" stroke="#3b82f6" strokeWidth="1.5" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-gray-700 mb-1">
            Upload clips to build training dataset
          </p>
          <p className="text-xs text-gray-400 mb-4">
            Drag & drop or select multiple images/videos. Assign a task to each,
            then process to generate labeled examples.
          </p>
          <button
            onClick={() => inputRef.current?.click()}
            className="text-sm font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 px-4 py-2 rounded-xl transition-colors"
          >
            Select Files
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {/* Dataset stats */}
      {clips.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Total Clips", value: clips.length, color: "text-gray-900" },
            {
              label: "Verified",
              value: verified.length,
              color: "text-blue-600",
            },
            { label: "Pass", value: passCount, color: "text-emerald-600" },
            { label: "Fail", value: failCount, color: "text-red-500" },
          ].map((s) => (
            <div
              key={s.label}
              className="bg-white rounded-xl shadow-soft p-3 text-center"
            >
              <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Clip list */}
      <AnimatePresence mode="popLayout">
        {clips.map((clip) => (
          <motion.div
            key={clip.id}
            layout
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.25 }}
            className="bg-white rounded-2xl shadow-soft p-4"
          >
            <div className="flex items-start gap-3">
              {/* Thumbnail */}
              <div className="w-16 h-12 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
                {clip.thumbnailDataUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={clip.thumbnailDataUrl}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-xs font-medium text-gray-600 truncate">
                    {clip.file.name}
                  </span>
                  <StatusBadge status={clip.status} verdict={clip.verdict} manualVerdict={clip.manualVerdict} />
                </div>

                {clip.status === "pending" || clip.status === "error" ? (
                  <input
                    type="text"
                    value={clip.task}
                    onChange={(e) => updateTask(clip.id, e.target.value)}
                    placeholder="Describe what the robot was supposed to do…"
                    className="w-full text-xs text-gray-700 placeholder-gray-300 bg-gray-50 rounded-lg px-2.5 py-1.5 outline-none border border-transparent focus:border-blue-200 transition-colors"
                  />
                ) : clip.status === "verified" && clip.result ? (
                  <div>
                    <p className="text-[11px] text-gray-500 leading-relaxed line-clamp-2">
                      {clip.result.summary}
                    </p>
                    {editingId === clip.id ? (
                      <div className="mt-2 space-y-1.5">
                        <div className="flex gap-1.5">
                          {(["PASS", "FAIL"] as const).map((v) => (
                            <button
                              key={v}
                              onClick={() => updateManualVerdict(clip.id, v)}
                              className={`flex-1 py-1 rounded-lg text-[10px] font-semibold transition-colors ${
                                (clip.manualVerdict ?? clip.verdict) === v
                                  ? v === "PASS"
                                    ? "bg-emerald-100 text-emerald-700"
                                    : "bg-red-100 text-red-700"
                                  : "bg-gray-100 text-gray-400 hover:bg-gray-200"
                              }`}
                            >
                              {v}
                            </button>
                          ))}
                        </div>
                        <input
                          type="text"
                          value={clip.correctionNote ?? ""}
                          onChange={(e) => updateCorrectionNote(clip.id, e.target.value)}
                          placeholder="Why was the AI wrong? (optional)"
                          className="w-full text-xs text-gray-700 placeholder-gray-300 bg-gray-50 rounded-lg px-2.5 py-1.5 outline-none border border-transparent focus:border-blue-200 transition-colors"
                        />
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-[10px] font-semibold text-[#2563eb] hover:text-[#1e40af]"
                        >
                          Done
                        </button>
                      </div>
                    ) : (
                      <div className="mt-1 flex items-center gap-2">
                        {clip.correctionNote && (
                          <p className="text-[10px] text-amber-600 italic flex-1 truncate">&quot;{clip.correctionNote}&quot;</p>
                        )}
                        <button
                          onClick={() => setEditingId(clip.id)}
                          className="text-[10px] text-gray-400 hover:text-gray-600 flex-shrink-0 flex items-center gap-0.5 ml-auto"
                        >
                          <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                            <path d="M7 1.5l1.5 1.5L3 8.5H1.5V7L7 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                          </svg>
                          {clip.manualVerdict ? "Edit correction" : "Correct"}
                        </button>
                      </div>
                    )}
                  </div>
                ) : clip.status === "processing" ? (
                  <div className="flex items-center gap-2">
                    <div className="h-1 flex-1 bg-gray-100 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-blue-400 rounded-full"
                        initial={{ width: "0%" }}
                        animate={{ width: "100%" }}
                        transition={{
                          duration: 8,
                          ease: "linear",
                          repeat: Infinity,
                        }}
                      />
                    </div>
                    <span className="text-[10px] text-blue-600 font-medium flex-shrink-0">
                      Analyzing…
                    </span>
                  </div>
                ) : null}

                {clip.errorMsg && (
                  <p className="text-[10px] text-red-500 mt-1">{clip.errorMsg}</p>
                )}
              </div>

              {/* Remove */}
              {clip.status !== "processing" && (
                <button
                  onClick={() => removeClip(clip.id)}
                  className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center flex-shrink-0 transition-colors"
                >
                  <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                    <path
                      d="M1.5 1.5l7 7M8.5 1.5l-7 7"
                      stroke="#9ca3af"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              )}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Action buttons */}
      {clips.length > 0 && (
        <div className="bg-white rounded-2xl shadow-soft p-4 space-y-3">
          {/* Process via GPT-4o */}
          <button
            onClick={processAll}
            disabled={!canProcess}
            className={`w-full py-3 rounded-xl text-sm font-semibold transition-all ${
              canProcess
                ? "bg-[#1e40af] text-white hover:bg-[#1e3a8a]"
                : "bg-gray-100 text-gray-300 cursor-not-allowed"
            }`}
          >
            {canProcess
              ? `Process ${pendingWithTask.length} clip${pendingWithTask.length !== 1 ? "s" : ""} via AI`
              : clips.every((c) => c.status !== "pending")
              ? "All clips processed"
              : "Add task descriptions to process clips"}
          </button>

          {/* Run on-device TF.js model */}
          {clips.some((c) => c.status === "pending") && (
            <button
              onClick={runAllLocal}
              disabled={localRunning}
              className={`w-full py-3 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                localRunning
                  ? "bg-gray-100 text-gray-300 cursor-not-allowed"
                  : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <rect x="1" y="3" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M5 8h6M8 5v6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
              {localRunning ? "Running on-device model…" : "Run On-Device Model (no API key)"}
            </button>
          )}

          <div className="grid grid-cols-2 gap-3">
            {/* Export */}
            <button
              onClick={() => exportDataset(clips)}
              disabled={!canExport}
              className={`py-2.5 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                canExport
                  ? "bg-blue-50 text-blue-700 hover:bg-blue-100"
                  : "bg-gray-50 text-gray-300 cursor-not-allowed"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path
                  d="M8 10V3M8 10l-3-3m3 3l3-3"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M2 12h12"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              Export .jsonl
            </button>

            {/* Simulate fine-tune */}
            <button
              onClick={simulateFineTune}
              disabled={!canFineTune || tuning}
              className={`py-2.5 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                canFineTune && !tuning
                  ? "bg-purple-50 text-purple-700 hover:bg-purple-100"
                  : "bg-gray-50 text-gray-300 cursor-not-allowed"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path
                  d="M8 2a6 6 0 100 12A6 6 0 008 2z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="M8 5v3l2 2"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              {tuning ? "Training…" : tuneDone ? "Re-tune Model" : "Simulate Fine-Tune"}
            </button>
          </div>

          {/* Fine-tune progress */}
          <AnimatePresence>
            {(tuning || tuneDone) && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="bg-purple-50 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-purple-700">
                      {tuneDone ? "Fine-tune Complete ✓" : "Fine-tuning model…"}
                    </span>
                    <span className="text-xs text-purple-600 font-mono">
                      {tuneProgress}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-purple-100 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-purple-500 rounded-full"
                      animate={{ width: `${tuneProgress}%` }}
                      transition={{ duration: 0.4, ease: "easeOut" }}
                    />
                  </div>
                  {tuneDone && (
                    <p className="text-[11px] text-purple-600">
                      Model updated with {verified.length} verified examples —
                      failure patterns absorbed into compliance layer.
                    </p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {clips.length === 0 && (
        <div className="bg-white rounded-2xl shadow-soft p-8 text-center">
          <p className="text-xs text-gray-400 leading-relaxed">
            Upload robot task clips, assign task descriptions, and process them
            with the AI verifier. The labeled results form a training dataset you
            can export and use to fine-tune the compliance model — so every
            corrected failure makes future robots smarter.
          </p>
        </div>
      )}
    </div>
  );
}
