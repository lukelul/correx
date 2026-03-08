"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface Props {
  onCapture: (file: File, preview: string) => void;
  onClose: () => void;
}

type CameraError = "permission_denied" | "no_hardware" | "other";

export default function CameraCapture({ onCapture, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraError, setCameraError] = useState<CameraError | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [isMobile, setIsMobile] = useState(false);
  const [networkUrl, setNetworkUrl] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);

  useEffect(() => {
    setIsMobile(/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent));
    // Check for multiple cameras
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      const cameras = devices.filter((d) => d.kind === "videoinput");
      setHasMultipleCameras(cameras.length > 1);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/network-info")
      .then((r) => r.json())
      .then((data) => {
        if (data.ip) {
          const port = window.location.port || "3000";
          setNetworkUrl(`http://${data.ip}:${port}`);
        }
      })
      .catch(() => {});
  }, []);

  const startCamera = useCallback(async (facing: "environment" | "user") => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err: unknown) {
      const e = err as DOMException;
      if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
        setCameraError("permission_denied");
        setErrorMessage(
          "Camera permission was denied. Please allow camera access in your browser settings, then reload the page."
        );
      } else if (
        e.name === "NotFoundError" ||
        e.name === "DevicesNotFoundError" ||
        e.name === "OverconstrainedError"
      ) {
        setCameraError("no_hardware");
        setErrorMessage(
          "No camera hardware was found on this device. Connect a camera or use a device with a built-in camera."
        );
      } else {
        setCameraError("other");
        setErrorMessage(e.message || "Unable to access the camera.");
      }
    }
  }, []);

  useEffect(() => {
    startCamera(facingMode);
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode]);

  const flipCamera = () => {
    setFacingMode((prev) => (prev === "environment" ? "user" : "environment"));
  };

  const capture = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || capturing) return;

    setCapturing(true);
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) { setCapturing(false); return; }
    ctx.drawImage(video, 0, 0);

    canvas.toBlob(
      (blob) => {
        if (!blob) { setCapturing(false); return; }
        const file = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
        const url = URL.createObjectURL(blob);
        onCapture(file, url);
        setCapturing(false);
      },
      "image/jpeg",
      0.92
    );
  };

  return (
    <div className="relative rounded-xl overflow-hidden bg-gray-900 min-h-[220px]">
      {cameraError ? (
        <div className="flex flex-col items-center justify-center p-8 gap-4 min-h-[220px]">
          <div
            className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
              cameraError === "permission_denied" ? "bg-amber-50" : "bg-red-50"
            }`}
          >
            {cameraError === "permission_denied" ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-5h2v2h-2zm0-8h2v6h-2z"
                  fill="#d97706"
                />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path
                  d="M17 10.5V7a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4v-11l-4 4z"
                  fill="#ef4444"
                  opacity="0.3"
                />
                <path d="M3 3l18 18" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
              </svg>
            )}
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-gray-200 mb-1">
              {cameraError === "permission_denied"
                ? "Camera Access Denied"
                : cameraError === "no_hardware"
                ? "No Camera Hardware Found"
                : "Camera Unavailable"}
            </p>
            <p className="text-xs text-gray-400 leading-relaxed max-w-[260px]">{errorMessage}</p>
          </div>

          {networkUrl && (
            <button
              onClick={() => setShowQr(true)}
              className="flex items-center gap-2 bg-blue-600 text-white text-xs font-semibold px-4 py-2 rounded-full hover:bg-blue-700 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="3" width="7" height="7" rx="1" stroke="white" strokeWidth="1.8" />
                <rect x="14" y="3" width="7" height="7" rx="1" stroke="white" strokeWidth="1.8" />
                <rect x="3" y="14" width="7" height="7" rx="1" stroke="white" strokeWidth="1.8" />
                <rect x="14" y="14" width="7" height="7" rx="1" fill="white" />
              </svg>
              Use phone camera instead
            </button>
          )}

          <button
            onClick={onClose}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : (
        <>
          {/* Live feed */}
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full max-h-64 object-cover"
          />

          {/* Top controls */}
          <div className="absolute top-2 left-2 right-2 flex items-center justify-between">
            {/* Phone camera QR button */}
            {networkUrl && (
              <button
                onClick={() => setShowQr((v) => !v)}
                className="flex items-center gap-1.5 bg-black/50 hover:bg-black/70 text-white text-[10px] font-semibold px-2.5 py-1.5 rounded-full transition-colors backdrop-blur-sm"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="3" width="7" height="7" rx="1" stroke="white" strokeWidth="2" />
                  <rect x="14" y="3" width="7" height="7" rx="1" stroke="white" strokeWidth="2" />
                  <rect x="3" y="14" width="7" height="7" rx="1" stroke="white" strokeWidth="2" />
                  <rect x="14" y="14" width="7" height="7" rx="1" fill="white" />
                </svg>
                Use phone
              </button>
            )}

            <div className="flex items-center gap-1.5 ml-auto">
              {/* Flip button — show if mobile or multiple cameras */}
              {(isMobile || hasMultipleCameras) && (
                <button
                  onClick={flipCamera}
                  className="w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center transition-colors backdrop-blur-sm"
                  title="Flip camera"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M20 7l-4-4-4 4M16 3v9M4 17l4 4 4-4M8 21v-9"
                      stroke="white"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              )}

              {/* Close */}
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center transition-colors backdrop-blur-sm"
              >
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                  <path d="M2 2l8 8M10 2L2 10" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>

          {/* Shutter button */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
            <motion.button
              onClick={capture}
              disabled={capturing}
              whileTap={{ scale: 0.92 }}
              className="w-14 h-14 rounded-full bg-white shadow-lg flex items-center justify-center border-4 border-gray-200 hover:border-blue-300 transition-colors"
            >
              {capturing ? (
                <span className="w-5 h-5 rounded-sm bg-gray-400" />
              ) : (
                <span className="w-10 h-10 rounded-full bg-white border-2 border-gray-300" />
              )}
            </motion.button>
          </div>
        </>
      )}

      {/* QR Code overlay */}
      <AnimatePresence>
        {showQr && networkUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center gap-3 p-4"
          >
            <p className="text-white text-xs font-semibold">Scan with phone (same WiFi)</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(networkUrl)}&bgcolor=ffffff&color=111827&margin=12`}
              alt="QR code to open app on phone"
              className="rounded-xl"
              width={150}
              height={150}
            />
            <p className="text-gray-300 text-[11px] font-mono">{networkUrl}</p>
            <p className="text-gray-400 text-[10px] text-center leading-relaxed max-w-[200px]">
              Open this URL on your phone — the rear camera will be used automatically
            </p>
            <button
              onClick={() => setShowQr(false)}
              className="text-white text-xs bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-full transition-colors"
            >
              Close
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
