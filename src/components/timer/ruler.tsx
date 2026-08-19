"use client";

import { animate, motion, useReducedMotion, useSpring } from "motion/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import { formatCountdown, SlidingNumber } from "./digits";

/**
 * An exceptionally polished horizontal duration selector.
 *
 * - The center marker stays fixed; the tick strip moves beneath it.
 * - Direct 1:1 pointer tracking with pointer capture.
 * - Velocity tracking with momentum after release.
 * - Velocity-aware snapping: a fast drag rolls to the next logical tick, a slow
 *   release snaps to the nearest one.
 * - Interrupting an in-flight momentum transfer preserves the current velocity.
 * - Ticks and labels respond continuously to their distance from selection.
 */

const MIN_TICK_SPACING = 22;
const SNAP_SPRING = { stiffness: 420, damping: 34, mass: 0.7 } as const;
const SNAP_VELOCITY_THRESHOLD = 1.6; // ticks/sec

export interface RulerGeometry {
  minMs: number;
  maxMs: number;
  /** Ticks worth of travel per CSS px. */
  pxPerMs: number;
  /** List of major tick values in ms. */
  ticks: number[];
  /** Adaptive snap step in ms. */
  snapMs: number;
}

/** Adaptive semantic stepping: coarse as the range grows, fine near the start. */
export function rulerGeometry(
  minMs: number,
  maxMs: number,
  width: number,
): RulerGeometry {
  const span = maxMs - minMs;
  const step = pickStep(span, width);
  const ticks: number[] = [];
  const start = Math.ceil(minMs / step) * step;
  for (let value = start; value <= maxMs + step / 2; value += step) {
    ticks.push(Math.min(value, maxMs));
  }
  // Ensure first & last are present.
  if (ticks[0] !== minMs) {
    ticks.unshift(minMs);
  }
  if (ticks[ticks.length - 1] !== maxMs) {
    ticks.push(maxMs);
  }
  return {
    minMs,
    maxMs,
    pxPerMs: width / span,
    ticks,
    snapMs: step,
  };
}

function pickStep(span: number, width: number): number {
  // Target ~10 major ticks across the strip.
  const target = span / Math.max(6, Math.floor(width / MIN_TICK_SPACING));
  const sizes = [
    1_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000,
    900_000, 1_800_000,
  ];
  for (const size of sizes) {
    if (target <= size) {
      return size;
    }
  }
  return 3_600_000;
}

export function DurationRuler({
  valueMs,
  minMs,
  maxMs,
  onCommit,
}: {
  valueMs: number;
  minMs: number;
  maxMs: number;
  onCommit: (valueMs: number) => void;
}) {
  const reduce = useReducedMotion();
  const [width, setWidth] = useState(280);
  const geometry = useMemo(
    () => rulerGeometry(minMs, maxMs, Math.max(120, width)),
    [maxMs, minMs, width],
  );

  const [drag, setDrag] = useState<{
    pointerMs: number;
    downX: number;
    downValue: number;
    lastX: number;
    lastT: number;
    velocity: number;
  } | null>(null);

  const [targetMs, setTargetMs] = useState(() =>
    clampValue(valueMs, minMs, maxMs),
  );
  const smooth = useSpring(targetMs, SNAP_SPRING);
  const [display, setDisplay] = useState(targetMs);
  const inertialRef = useRef<ReturnType<typeof animate> | null>(null);

  // Keep local target in sync when the plugin publishes a new value.
  useEffect(() => {
    setTargetMs(clampValue(valueMs, minMs, maxMs));
  }, [valueMs, minMs, maxMs]);

  useEffect(() => {
    const stop = smooth.on("change", (latest) => {
      if (!drag) {
        setDisplay(latest);
      }
    });
    return stop;
  }, [smooth, drag]);

  // Width measurement for the strip.
  const stripRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = stripRef.current;
    if (!node) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 280;
      setWidth(w);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const stopInertia = useCallback(() => {
    if (inertialRef.current) {
      inertialRef.current.stop();
      inertialRef.current = null;
    }
  }, []);

  const snapFrom = useCallback(
    (value: number, velocity: number) => {
      const step = geometry.snapMs;
      let nearest = Math.round((value - minMs) / step) * step + minMs;
      // Velocity-aware: a fast fling rolls forward/back an extra tick.
      if (Math.abs(velocity) >= SNAP_VELOCITY_THRESHOLD) {
        nearest += Math.sign(velocity) * step;
      }
      nearest = clampValue(nearest, minMs, maxMs);
      setTargetMs(nearest);
      onCommit(nearest);
    },
    [geometry.snapMs, maxMs, minMs, onCommit],
  );

  const release = useCallback(
    (velocity: number) => {
      setDrag((current) => {
        if (!current) {
          return current;
        }
        const currentValue = current.pointerMs;
        const velMs = velocity * (currentValue - current.downValue) * 0.001;
        const momentum = velMs * 260;
        if (Math.abs(momentum) > geometry.snapMs * 0.4 && !reduce) {
          // Animate momentum then snap.
          const start = currentValue;
          const end = start + momentum;
          inertialRef.current = animate(0, 1, {
            duration: 0.55,
            ease: (t) => 1 - (1 - t) ** 3,
            onUpdate: (t) => {
              setTargetMs(clampValue(start + (end - start) * t, minMs, maxMs));
            },
            onComplete: () => {
              snapFrom(end, velocity);
            },
          });
        } else {
          snapFrom(currentValue, velocity);
        }
        return null;
      });
    },
    [geometry.snapMs, maxMs, minMs, reduce, snapFrom, smooth],
  );

  const onPointerDown = (event: React.PointerEvent) => {
    stopInertia();
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const value = valueAtX(x, rect.width, minMs, maxMs);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setDrag({
      pointerMs: value,
      downX: x,
      downValue: value,
      lastX: x,
      lastT: performance.now(),
      velocity: 0,
    });
    event.preventDefault();
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!drag) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const nowT = performance.now();
    const value = valueAtX(x, rect.width, minMs, maxMs);
    const dt = Math.max(1, nowT - drag.lastT);
    const velocity = (value - drag.pointerMs) / dt;
    setDrag({
      ...drag,
      pointerMs: value,
      lastX: x,
      lastT: nowT,
      velocity: velocity * 0.5 + drag.velocity * 0.5,
    });
    setTargetMs(value);
    setDisplay(value);
  };

  const onPointerUp = () => {
    const velocity = drag?.velocity ?? 0;
    release(velocity);
  };

  // Keyboard operation.
  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = geometry.snapMs;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      const next = clampValue(targetMs - step, minMs, maxMs);
      setTargetMs(next);
      onCommit(next);
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = clampValue(targetMs + step, minMs, maxMs);
      setTargetMs(next);
      onCommit(next);
    } else if (event.key === "Home") {
      event.preventDefault();
      setTargetMs(minMs);
      onCommit(minMs);
    } else if (event.key === "End") {
      event.preventDefault();
      setTargetMs(maxMs);
      onCommit(maxMs);
    }
  };

  const displayedValue = drag ? targetMs : display;
  const ticks = geometry.ticks;

  return (
    <div className="duration-ruler" style={{ width: "100%" }}>
      <div className="duration-ruler-readout">
        <SlidingNumber value={displayedValue} format={formatCountdown} />
      </div>
      <div
        ref={stripRef}
        className={cn("duration-ruler-strip", drag && "is-dragging")}
        role="slider"
        aria-valuemin={minMs}
        aria-valuemax={maxMs}
        aria-valuenow={Math.round(displayedValue)}
        aria-label="Duration"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <motion.div
          className="duration-ruler-track"
          animate={{
            x: width / 2 - valueToX(displayedValue, minMs, maxMs, width),
          }}
          transition={drag ? { duration: 0 } : SNAP_SPRING}
          style={{ position: "absolute", inset: 0 }}
        >
          {ticks.map((tick) => {
            const isMajor =
              tick % (geometry.snapMs * 5) === 0 ||
              tick === minMs ||
              tick === maxMs;
            const distance = Math.abs(tick - displayedValue) / geometry.snapMs;
            const near = Math.max(0, 1 - distance / 4);
            const label =
              tick % (geometry.snapMs * 5) === 0 ||
              tick === minMs ||
              tick === maxMs;
            return (
              <div
                key={tick}
                className="duration-ruler-tick-wrap"
                style={{
                  position: "absolute",
                  left: valueToX(tick, minMs, maxMs, width),
                  top: 0,
                  transform: "translateX(-50%)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  width: 40,
                }}
              >
                <span
                  className={cn("duration-ruler-tick", isMajor && "is-major")}
                  style={{
                    height: 4 + near * 6,
                    opacity: 0.25 + near * 0.75,
                    background:
                      near > 0.6 ? "var(--island-fg)" : "var(--island-muted)",
                  }}
                />
                {label ? (
                  <span
                    className="duration-ruler-label"
                    style={{
                      opacity: 0.3 + near * 0.7,
                      fontWeight: near > 0.7 ? 600 : 400,
                      transform: `translateY(${near * -1}px)`,
                    }}
                  >
                    {formatTickLabel(tick)}
                  </span>
                ) : null}
              </div>
            );
          })}
        </motion.div>
        <div className="duration-ruler-marker" aria-hidden>
          <div className="duration-ruler-marker-line" />
        </div>
      </div>
    </div>
  );
}

function valueAtX(
  x: number,
  width: number,
  minMs: number,
  maxMs: number,
): number {
  const ratio = Math.min(1, Math.max(0, x / width));
  return minMs + ratio * (maxMs - minMs);
}

function valueToX(
  value: number,
  minMs: number,
  maxMs: number,
  width: number,
): number {
  const ratio = (value - minMs) / (maxMs - minMs);
  return ratio * width;
}

function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatTickLabel(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 60) {
    return `${totalMinutes}`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h${minutes}`;
}
