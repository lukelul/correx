"use client";

import { motion } from "framer-motion";

const STEPS = [
  { label: "Parsing visual input", icon: "👁" },
  { label: "Analyzing task completion", icon: "✓" },
  { label: "Scanning for safety hazards", icon: "⚠" },
  { label: "Evaluating environmental state", icon: "◎" },
  { label: "Generating compliance report", icon: "▤" },
];

interface ProcessingAnimationProps {
  currentStep: number;
}

export default function ProcessingAnimation({ currentStep }: ProcessingAnimationProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="w-full"
    >
      <div className="bg-white rounded-2xl shadow-soft p-8">
        <div className="flex flex-col items-center mb-8">
          <div className="relative w-16 h-16 mb-4">
            <motion.div
              className="absolute inset-0 rounded-full border-2 border-gray-100"
            />
            <motion.div
              className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-500"
              animate={{ rotate: 360 }}
              transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
            />
            <motion.div
              className="absolute inset-2 rounded-full border-2 border-transparent border-t-blue-300"
              animate={{ rotate: -360 }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <motion.div
                className="w-2 h-2 rounded-full bg-blue-500"
                animate={{ scale: [1, 1.3, 1] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
              />
            </div>
          </div>
          <p className="text-sm font-medium text-gray-500 tracking-wide uppercase text-xs">
            Verifying
          </p>
        </div>

        <div className="space-y-3">
          {STEPS.map((step, i) => {
            const isDone = i < currentStep;
            const isActive = i === currentStep;

            return (
              <motion.div
                key={step.label}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.08, duration: 0.3 }}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors duration-300 ${
                  isActive
                    ? "bg-blue-50"
                    : isDone
                    ? "bg-gray-50/80"
                    : "bg-transparent"
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-300 ${
                    isDone
                      ? "bg-emerald-100"
                      : isActive
                      ? "bg-blue-100"
                      : "bg-gray-100"
                  }`}
                >
                  {isDone ? (
                    <motion.svg
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 500, damping: 25 }}
                      width="10"
                      height="10"
                      viewBox="0 0 12 12"
                      fill="none"
                    >
                      <path
                        d="M2 6l3 3 5-5"
                        stroke="#10b981"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </motion.svg>
                  ) : isActive ? (
                    <motion.div
                      className="w-1.5 h-1.5 rounded-full bg-blue-500"
                      animate={{ scale: [1, 1.4, 1] }}
                      transition={{ duration: 0.8, repeat: Infinity }}
                    />
                  ) : (
                    <div className="w-1.5 h-1.5 rounded-full bg-gray-300" />
                  )}
                </div>

                <span
                  className={`text-sm transition-colors duration-300 ${
                    isDone
                      ? "text-gray-500"
                      : isActive
                      ? "text-blue-700 font-medium"
                      : "text-gray-300"
                  }`}
                >
                  {step.label}
                </span>

                {isActive && (
                  <motion.div
                    className="ml-auto flex gap-0.5"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  >
                    {[0, 1, 2].map((dot) => (
                      <motion.div
                        key={dot}
                        className="w-1 h-1 rounded-full bg-blue-400"
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{
                          duration: 1,
                          repeat: Infinity,
                          delay: dot * 0.2,
                        }}
                      />
                    ))}
                  </motion.div>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
