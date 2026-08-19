"use client";

import { durationParts, TimeReadout } from "@/components/clock/time-readout";
import { useNowMs } from "@/idle/clock";
import { cn } from "@/lib/utils";

export function formatCountdown(ms: number): string {
  const parts = durationParts(ms);
  if (parts.hours > 0) {
    return `${parts.hours}:${parts.minutes.toString().padStart(2, "0")}:${parts.seconds.toString().padStart(2, "0")}`;
  }
  return `${parts.minutes}:${parts.seconds.toString().padStart(2, "0")}`;
}

export function RollingDigits({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  return <span className={cn("tabular-nums", className)}>{value}</span>;
}

export function SlidingNumber({
  value,
  format,
  className,
}: {
  value: number;
  format: (value: number) => string;
  className?: string;
}) {
  return <span className={cn("tabular-nums", className)}>{format(value)}</span>;
}

export function CountdownClock({
  deadlineMs,
  running,
  pausedRemainingMs,
  className,
}: {
  deadlineMs: number;
  running: boolean;
  pausedRemainingMs?: number | null;
  totalMs?: number | null;
  className?: string;
  wheels?: boolean;
  onExpired?: () => void;
}) {
  const now = useNowMs(running);
  const remaining = running
    ? Math.max(0, deadlineMs - now)
    : (pausedRemainingMs ?? Math.max(0, deadlineMs - now));
  const parts = durationParts(remaining);

  return (
    <TimeReadout
      className={cn("ui-countdown", className)}
      hours={parts.hours}
      minutes={parts.minutes}
      seconds={parts.seconds}
      showHours={parts.hours > 0}
      showSeconds
    />
  );
}

export function UiCountdown({
  deadlineMs,
  running,
  pausedRemainingMs,
}: {
  deadlineMs: number;
  running: boolean;
  pausedRemainingMs?: number | null;
  totalMs?: number | null;
  onAction: (id: string, payload?: string) => void;
}) {
  return (
    <CountdownClock
      deadlineMs={deadlineMs}
      running={running}
      pausedRemainingMs={pausedRemainingMs}
    />
  );
}
