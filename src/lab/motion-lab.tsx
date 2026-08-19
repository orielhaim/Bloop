"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { formatCountdown, RollingDigits } from "@/components/timer/digits";
import { WheelDurationPicker } from "@/components/timer/wheel-duration";
import { cn } from "@/lib/utils";

/**
 * Internal motion/transition iteration harness. Replays the milestone's core
 * transitions (clock -> timer, timer -> now playing, resident -> volume,
 * transient -> resident, config -> running) repeatedly so pixel-perfect work
 * can be tuned without launching real apps.
 */

type TransitionKey = string;

interface Step {
  key: TransitionKey;
  label: string;
}

const transitions: Step[] = [
  { key: "clock", label: "Clock" },
  { key: "timer-config", label: "Timer config" },
  { key: "timer-running", label: "Timer running" },
  { key: "timer+playing", label: "Timer + Now Playing" },
  { key: "volume", label: "Volume transient" },
  { key: "timer+playing", label: "Resident returns" },
  { key: "bluetooth", label: "Bluetooth" },
  { key: "clock", label: "Home" },
];

export function MotionLab() {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [interval, setIntervalMs] = useState(1400);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!playing) {
      return;
    }
    const timer = window.setTimeout(() => {
      setIndex((current) => (current + 1) % transitions.length);
    }, interval);
    return () => window.clearTimeout(timer);
  }, [interval, playing, index]);

  const step = transitions[index];
  const next = () => setIndex((current) => (current + 1) % transitions.length);
  const prev = () =>
    setIndex(
      (current) => (current - 1 + transitions.length) % transitions.length,
    );

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center gap-8 bg-[#0b0b0d] p-8 text-zinc-100">
      <header className="flex w-full flex-wrap items-center justify-between gap-4">
        <h1 className="font-heading text-2xl tracking-tight">Motion Lab</h1>
        <div className="flex items-center gap-3 text-xs text-zinc-400">
          <span className="rounded-full bg-white/5 px-3 py-1 ring-1 ring-white/10">
            {step.label}
          </span>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <button
          type="button"
          onClick={prev}
          className="rounded-lg bg-white/8 px-3 py-1.5 ring-1 ring-white/10"
        >
          Prev
        </button>
        <button
          type="button"
          onClick={next}
          className="rounded-lg bg-white/8 px-3 py-1.5 ring-1 ring-white/10"
        >
          Next
        </button>
        <button
          type="button"
          onClick={() => setPlaying((value) => !value)}
          className={cn(
            "rounded-lg px-3 py-1.5 ring-1",
            playing ? "bg-white/10 ring-white/30" : "bg-white/8 ring-white/10",
          )}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <label className="flex items-center gap-2">
          {interval}ms
          <input
            type="range"
            min={400}
            max={3000}
            step={100}
            value={interval}
            onChange={(event) => setIntervalMs(Number(event.target.value))}
            className="accent-foreground"
          />
        </label>
      </div>

      {/* The replayed transition surface */}
      <div
        className="flex min-h-[160px] w-full items-center justify-center rounded-3xl"
        style={{
          background: "#0a0a0a",
          boxShadow: "0 18px 40px rgb(0 0 0 / 35%)",
        }}
      >
        <AnimatePresence mode="popLayout">
          <motion.div
            key={step.key}
            layout
            initial={{ opacity: 0, scale: 0.92, filter: "blur(6px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.94, filter: "blur(6px)" }}
            transition={
              reduce
                ? { duration: 0 }
                : { duration: 0.42, ease: [0.22, 1, 0.36, 1] as const }
            }
            className="px-6 py-4"
          >
            <FaceForStep step={step.key} />
          </motion.div>
        </AnimatePresence>
      </div>

      <p className="max-w-xl text-center text-xs leading-5 text-zinc-500">
        {describe(step.key)}
      </p>
    </div>
  );
}

function FaceForStep({ step }: { step: TransitionKey }) {
  switch (step) {
    case "clock":
      return <ClockFace />;
    case "timer-config":
      return <TimerConfigFace />;
    case "timer-running":
      return <TimerRunningFace />;
    case "timer+playing":
      return <ResidentCompositionFace />;
    case "volume":
      return <VolumeFace />;
    case "bluetooth":
      return <BluetoothFace />;
    default:
      return <ClockFace />;
  }
}

function ClockFace() {
  return <RollingDigits value="17:04" className="text-[20px]" />;
}

function TimerConfigFace() {
  return (
    <div className="flex w-72 flex-col items-center gap-3">
      <RollingDigits value="5:00" className="text-[40px]" />
      <WheelDurationPicker
        valueMs={300_000}
        minMs={5_000}
        maxMs={3 * 3600_000}
        onCommit={() => undefined}
      />
    </div>
  );
}

function TimerRunningFace() {
  return (
    <span className="flex items-center gap-3">
      <span className="ui-symbol" aria-hidden>
        ⏱
      </span>
      <RollingDigits
        value={formatCountdown(18 * 60_000 + 42_000)}
        className="text-[22px]"
      />
    </span>
  );
}

function ResidentCompositionFace() {
  return (
    <div className="flex items-center gap-4">
      <span className="ui-symbol" aria-hidden>
        ⏱
      </span>
      <RollingDigits
        value={formatCountdown(18 * 60_000 + 42_000)}
        className="text-[20px]"
      />
      <span className="ui-separator" />
      <span className="waveform is-active" aria-hidden>
        {[0.45, 0.9, 0.6, 1, 0.7].map((level) => (
          <span
            key={level}
            className="waveform-bar"
            style={{ "--level": level } as React.CSSProperties}
          />
        ))}
      </span>
      <span className="ui-text">Song Title</span>
    </div>
  );
}

function VolumeFace() {
  return (
    <span className="flex items-center gap-3">
      <span className="ui-symbol" aria-hidden>
        🔊
      </span>
      <span className="ui-progress">
        <span className="ui-progress-fill" style={{ width: "72%" }} />
      </span>
      <RollingDigits value="72%" className="text-[15px]" />
    </span>
  );
}

function BluetoothFace() {
  return (
    <span className="flex items-center gap-3">
      <span className="ui-symbol" aria-hidden>
        🎧
      </span>
      <span>
        <span className="ui-text">Buds</span>
        <span className="ui-secondary">Connected · 84%</span>
      </span>
    </span>
  );
}

function describe(step: TransitionKey): string {
  switch (step) {
    case "clock":
      return "The resting island: a polished clock with stable digit geometry.";
    case "timer-config":
      return "Timer configuration: the duration ruler with momentum and velocity-aware snapping.";
    case "timer-running":
      return "Timer running: the countdown becomes the hero, digits roll on change.";
    case "timer+playing":
      return "Timer + Now Playing compose as adjacent segments with a stable divider.";
    case "volume":
      return "A transient volume presentation temporarily takes over the resident composition.";
    case "bluetooth":
      return "A device event surfaces as a transient; the resident composition returns after.";
    default:
      return "";
  }
}
