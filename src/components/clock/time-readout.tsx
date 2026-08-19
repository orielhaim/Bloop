"use client";

import { NumberTicker } from "@/components/ui/number-ticker";
import type { ClockMotion } from "@/lib/engine/types";
import { cn } from "@/lib/utils";

export function durationParts(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
    totalSeconds: total,
  };
}

export function wallParts(now: Date, hour12 = false) {
  const hours24 = now.getHours();
  const hours = hour12 ? hours24 % 12 || 12 : hours24;
  return {
    hours,
    minutes: now.getMinutes(),
    seconds: now.getSeconds(),
  };
}

function pad(value: number, width: number) {
  return value.toString().padStart(width, "0");
}

export function TimeReadout({
  hours = 0,
  minutes,
  seconds,
  showHours = false,
  showSeconds = true,
  padHours = false,
  motion = "tick",
  className,
}: {
  hours?: number;
  minutes: number;
  seconds: number;
  showHours?: boolean;
  showSeconds?: boolean;
  padHours?: boolean;
  motion?: ClockMotion;
  className?: string;
}) {
  const hourPad = padHours || hours >= 10 ? 2 : 1;
  const label = [
    showHours ? pad(hours, hourPad) : null,
    pad(minutes, 2),
    showSeconds ? pad(seconds, 2) : null,
  ]
    .filter(Boolean)
    .join(":");

  if (motion === "smooth") {
    return (
      <span className={cn("time-readout is-smooth", className)}>
        {label.split("").map((char, index) =>
          char === ":" ? (
            <span key={`colon-${index}`} className="time-colon" aria-hidden>
              :
            </span>
          ) : (
            <span key={`digit-${index}`} className="time-smooth-slot">
              {char}
            </span>
          ),
        )}
      </span>
    );
  }

  return (
    <span className={cn("time-readout", className)}>
      {showHours ? (
        <>
          <NumberTicker
            value={hours}
            pad={hourPad}
            duration={0.32}
            stagger={0}
            startOnView={false}
          />
          <span className="time-colon" aria-hidden>
            :
          </span>
        </>
      ) : null}
      <NumberTicker
        value={minutes}
        pad={2}
        duration={0.32}
        stagger={0}
        startOnView={false}
      />
      {showSeconds ? (
        <>
          <span className="time-colon" aria-hidden>
            :
          </span>
          <NumberTicker
            value={seconds}
            pad={2}
            duration={0.32}
            stagger={0}
            startOnView={false}
          />
        </>
      ) : null}
    </span>
  );
}
