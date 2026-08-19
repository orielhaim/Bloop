"use client";

import { useMemo } from "react";
import { TimeWheels } from "@/components/clock/time-wheels";
import { cn } from "@/lib/utils";

export function WheelDurationPicker({
  valueMs,
  minMs,
  maxMs,
  onCommit,
  className,
}: {
  valueMs: number;
  minMs: number;
  maxMs: number;
  onCommit: (valueMs: number) => void;
  className?: string;
}) {
  const safeMax = Number.isFinite(maxMs) && maxMs > 0 ? maxMs : 59 * 60_000;
  const safeMin = Number.isFinite(minMs) && minMs > 0 ? minMs : 5_000;
  const safeValue = Number.isFinite(valueMs) ? valueMs : safeMin;
  const minuteMax = Math.max(1, Math.min(99, Math.floor(safeMax / 60_000)));
  const clamped = Math.max(safeMin, Math.min(safeValue, safeMax));
  const minutes = Math.floor(clamped / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1000);

  const commit = useMemo(
    () => (next: { minutes: number; seconds: number }) => {
      const raw = next.minutes * 60_000 + next.seconds * 1000;
      onCommit(Math.max(safeMin, Math.min(raw, safeMax)));
    },
    [safeMax, safeMin, onCommit],
  );

  return (
    <div className={cn("wheel-duration-picker", className)}>
      <TimeWheels
        minutes={minutes}
        seconds={seconds}
        minuteMax={minuteMax}
        interactive
        size="expanded"
        onChange={commit}
      />
    </div>
  );
}
