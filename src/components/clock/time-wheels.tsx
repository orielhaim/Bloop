"use client";

import { useMemo } from "react";
import { WheelPicker } from "@/components/ui/wheel-picker";
import { cn } from "@/lib/utils";

function padded(max: number) {
  const count = Math.max(
    0,
    Math.min(99, Math.floor(Number.isFinite(max) ? max : 0)),
  );
  return Array.from({ length: count + 1 }, (_, value) => ({
    value: String(value),
    label: value.toString().padStart(2, "0"),
  }));
}

const SECONDS = padded(59);

export function TimeWheels({
  minutes,
  seconds,
  minuteMax = 59,
  interactive = false,
  onChange,
  size = "peek",
  className,
}: {
  minutes: number;
  seconds: number;
  minuteMax?: number;
  interactive?: boolean;
  onChange?: (next: { minutes: number; seconds: number }) => void;
  size?: "peek" | "expanded";
  className?: string;
}) {
  const minuteOptions = useMemo(() => padded(minuteMax), [minuteMax]);
  const compact = size === "peek";
  const itemHeight = compact ? 20 : 24;
  const visibleCount = compact ? 3 : 5;

  return (
    <div className={cn("time-wheels", size, className)}>
      <WheelPicker
        options={minuteOptions}
        value={String(Math.min(minuteMax, Math.max(0, minutes)))}
        onValueChange={(value) =>
          onChange?.({ minutes: Number(value), seconds })
        }
        visibleCount={visibleCount}
        itemHeight={itemHeight}
        readOnly={!interactive}
        aria-label="Minutes"
      />
      <span className="time-wheels-colon" aria-hidden>
        :
      </span>
      <WheelPicker
        options={SECONDS}
        value={String(Math.min(59, Math.max(0, seconds)))}
        onValueChange={(value) =>
          onChange?.({ minutes, seconds: Number(value) })
        }
        visibleCount={visibleCount}
        itemHeight={itemHeight}
        readOnly={!interactive}
        aria-label="Seconds"
      />
      <span className="time-wheel-label">min</span>
      <span />
      <span className="time-wheel-label">sec</span>
    </div>
  );
}
