"use client";

import { useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface UploadZoneProps {
  onFileSelect: (file: File, preview: string) => void;
  disabled?: boolean;
}

export default function UploadZone({ onFileSelect, disabled }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = useCallback(
    (file: File) => {
      if (!file) return;
      const isImage = file.type.startsWith("image/");
      const isVideo = file.type.startsWith("video/");
      if (!isImage && !isVideo) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        onFileSelect(file, e.target?.result as string);
      };
      reader.readAsDataURL(file);
    },
    [onFileSelect]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (disabled) return;
      const file = e.dataTransfer.files[0];
      handleFile(file);
    },
    [disabled, handleFile]
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <motion.label
      htmlFor="file-upload"
      className={`relative flex flex-col items-center justify-center w-full rounded-2xl border-2 border-dashed cursor-pointer transition-colors duration-200 ${
        disabled
          ? "opacity-50 cursor-not-allowed border-gray-200 bg-gray-50"
          : isDragging
          ? "border-blue-400 bg-blue-50/60"
          : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/50"
      }`}
      style={{ minHeight: "200px" }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      whileHover={disabled ? {} : { scale: 1.005 }}
      whileTap={disabled ? {} : { scale: 0.998 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
    >
      <input
        id="file-upload"
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={handleInputChange}
        disabled={disabled}
      />

      <AnimatePresence mode="wait">
        <motion.div
          key={isDragging ? "dragging" : "idle"}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
          className="flex flex-col items-center gap-3 p-8 text-center"
        >
          <div
            className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors duration-200 ${
              isDragging ? "bg-blue-100" : "bg-gray-100"
            }`}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke={isDragging ? "#3b82f6" : "#9ca3af"}
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <div>
            <p className={`text-sm font-medium ${isDragging ? "text-blue-600" : "text-gray-600"}`}>
              {isDragging ? "Drop to upload" : "Upload image or video"}
            </p>
            <p className="text-xs text-gray-400 mt-1">Drag & drop or click to browse</p>
          </div>
        </motion.div>
      </AnimatePresence>
    </motion.label>
  );
}
