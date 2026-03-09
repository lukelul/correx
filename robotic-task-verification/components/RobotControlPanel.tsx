"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { MotorCommands } from "@/app/api/verify/route";

interface Props {
  commands: MotorCommands;
}

function useCounter(target: number, duration = 1300, delay = 0) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (target === 0) { setVal(0); return; }
    let rafId: number;
    const startAt = performance.now() + delay;
    const tick = (now: number) => {
      if (now < startAt) { rafId = requestAnimationFrame(tick); return; }
      const elapsed = now - startAt;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setVal(parseFloat((target * eased).toFixed(1)));
      if (progress < 1) rafId = requestAnimationFrame(tick);
      else setVal(target);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [target, duration, delay]);
  return val;
}

function AxisRow({
  label,
  value,
  unit,
  maxAbs,
  color,
  delay = 0,
  arrow,
}: {
  label: string;
  value: number;
  unit: string;
  maxAbs: number;
  color: string;
  delay?: number;
  arrow?: string;
}) {
  const animated = useCounter(value, 1300, delay);
  const pct = Math.min(Math.abs(animated) / maxAbs, 1) * 100;
  const isNeg = value < 0;
  const isZero = value === 0;

  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-20 font-mono text-[11px] font-bold text-cyan-500 tracking-widest flex-shrink-0">
        {label}
      </span>
      <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${color}`}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 1.3, delay: delay / 1000, ease: [0.25, 0.46, 0.45, 0.94] }}
        />
      </div>
      <div className="w-28 flex items-center justify-end gap-1.5 flex-shrink-0">
        <span
          className={`font-mono text-sm font-bold tabular-nums ${
            isZero ? "text-gray-600" : isNeg ? "text-red-400" : "text-emerald-400"
          }`}
        >
          {isNeg ? "" : value > 0 ? "+" : ""}{animated.toFixed(1)}
        </span>
        <span className="font-mono text-[10px] text-gray-500">{unit}</span>
        {arrow && !isZero && (
          <span className="text-xs text-gray-500">{arrow}</span>
        )}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-2 mt-4 first:mt-0">
      <div className="h-px flex-1 bg-white/5" />
      <span className="text-[9px] font-bold text-gray-600 uppercase tracking-widest">{children}</span>
      <div className="h-px flex-1 bg-white/5" />
    </div>
  );
}

export default function RobotControlPanel({ commands }: Props) {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setActive(true), 200);
    return () => clearTimeout(t);
  }, []);

  const { translation: t, wrist_rotate, wrist_pitch, gripper_width_mm, approach_angle_deg } = commands;

  const hasJoints = wrist_rotate !== 0 || wrist_pitch !== 0;
  const hasGripper = gripper_width_mm !== null;
  const hasApproach = approach_angle_deg !== null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.88, duration: 0.4 }}
      className="rounded-2xl overflow-hidden border border-white/[0.06] bg-[#080d18]"
    >
      {/* Header */}
      <div className="px-5 py-3 bg-[#0d1424] border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className={`w-2 h-2 rounded-full ${active ? "bg-emerald-400 animate-pulse" : "bg-gray-700"}`} />
          <span className="font-mono text-[11px] font-bold text-gray-300 uppercase tracking-widest">
            Motor Command Preview
          </span>
        </div>
        <span className="font-mono text-[9px] text-gray-600 uppercase tracking-widest">
          SIM · {active ? "EXECUTING" : "STANDBY"}
        </span>
      </div>

      <div className="px-5 py-4">
        {/* Translation */}
        <SectionLabel>Translation (cm)</SectionLabel>
        <AxisRow label="X  LATERAL" value={t.x} unit="cm" maxAbs={20} color="bg-blue-500" delay={0} arrow={t.x > 0 ? "→" : t.x < 0 ? "←" : undefined} />
        <AxisRow label="Y  DEPTH  " value={t.y} unit="cm" maxAbs={20} color="bg-blue-500" delay={80} arrow={t.y > 0 ? "↑" : t.y < 0 ? "↓" : undefined} />
        <AxisRow label="Z  VERTICAL" value={t.z} unit="cm" maxAbs={20} color="bg-blue-500" delay={160} arrow={t.z > 0 ? "↑" : t.z < 0 ? "↓" : undefined} />

        {/* Joints */}
        {hasJoints && (
          <>
            <SectionLabel>Wrist Joints (°)</SectionLabel>
            {wrist_rotate !== 0 && (
              <AxisRow label="ROTATE    " value={wrist_rotate} unit="°" maxAbs={90} color="bg-violet-500" delay={260} arrow={wrist_rotate > 0 ? "↻" : "↺"} />
            )}
            {wrist_pitch !== 0 && (
              <AxisRow label="PITCH     " value={wrist_pitch} unit="°" maxAbs={90} color="bg-violet-500" delay={340} arrow={wrist_pitch > 0 ? "↓" : "↑"} />
            )}
          </>
        )}

        {/* Approach angle */}
        {hasApproach && approach_angle_deg !== null && (
          <>
            <SectionLabel>Approach</SectionLabel>
            <AxisRow label="ANGLE     " value={approach_angle_deg} unit="°" maxAbs={90} color="bg-amber-500" delay={420} arrow="↘" />
          </>
        )}

        {/* Gripper */}
        {hasGripper && gripper_width_mm !== null && (
          <>
            <SectionLabel>Gripper</SectionLabel>
            <AxisRow label="WIDTH     " value={gripper_width_mm} unit="mm" maxAbs={100} color="bg-emerald-500" delay={500} />
          </>
        )}

        {/* Status row */}
        <div className="mt-4 pt-3 border-t border-white/[0.05] flex items-center justify-between">
          <span className="font-mono text-[9px] text-gray-700 uppercase tracking-widest">
            Δt est. 2.4s · 6-DOF sim
          </span>
          <motion.div
            className="flex items-center gap-1.5"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.6 }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="font-mono text-[9px] text-emerald-600 uppercase tracking-widest">
              Commands ready
            </span>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}
