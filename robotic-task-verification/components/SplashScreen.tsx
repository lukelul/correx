"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

interface Props {
  onDone: () => void;
}

export default function SplashScreen({ onDone }: Props) {
  const [expanding, setExpanding] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setExpanding(true), 1900);
    const t2 = setTimeout(onDone, 2700);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 z-50" style={{ backgroundColor: "#1e40af" }}>
      <div className="absolute inset-0 overflow-hidden flex items-center justify-center">

        {/* Ring 1 — lightest blue, fastest: visible leading edge */}
        <motion.div
          className="absolute rounded-full"
          style={{ width: "200vmax", height: "200vmax", backgroundColor: "#60a5fa" }}
          initial={{ scale: 0 }}
          animate={{ scale: 1, opacity: expanding ? 0 : 1 }}
          transition={{
            scale: { duration: 0.95, ease: "easeOut" },
            opacity: { duration: 0.45 },
          }}
        />

        {/* Ring 2 — medium blue */}
        <motion.div
          className="absolute rounded-full"
          style={{ width: "200vmax", height: "200vmax", backgroundColor: "#2563eb" }}
          initial={{ scale: 0 }}
          animate={{ scale: 1, opacity: expanding ? 0 : 1 }}
          transition={{
            scale: { duration: 1.25, ease: "easeOut" },
            opacity: { duration: 0.45 },
          }}
        />

        {/* Ring 3 — darkest blue, slowest: fills last so this is the final color */}
        <motion.div
          className="absolute rounded-full"
          style={{ width: "200vmax", height: "200vmax", backgroundColor: "#1e40af" }}
          initial={{ scale: 0 }}
          animate={{ scale: 1, opacity: expanding ? 0 : 1 }}
          transition={{
            scale: { duration: 1.6, ease: "easeOut" },
            opacity: { duration: 0.45 },
          }}
        />

        {/* Cream inner circle */}
        <motion.div
          className="absolute rounded-full"
          style={{ width: "52vmin", height: "52vmin", backgroundColor: "#f8f8f7" }}
          initial={{ scale: 0 }}
          animate={{ scale: expanding ? 7 : 1 }}
          transition={
            expanding
              ? { duration: 0.85, ease: [0.4, 0, 1, 1] }
              : { duration: 0.55, delay: 0.8, ease: [0.34, 1.4, 0.64, 1] }
          }
        />
      </div>

      {/* Correx text — stays at full opacity, home h1 takes over on unmount */}
      <div className="absolute inset-0 flex items-center justify-center">
        <motion.span
          className="font-bold text-gray-900 select-none"
          style={{
            fontFamily: "var(--font-satisfy)",
            fontSize: "3rem",
            display: "block",
            width: "fit-content",
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35, delay: 1.05 }}
        >
          Correx
        </motion.span>
      </div>
    </div>
  );
}
