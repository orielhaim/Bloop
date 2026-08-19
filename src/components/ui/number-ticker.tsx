"use client";

import { useReducedMotion } from "motion/react";
import { useMemo } from "react";
import { EASE_OUT_CSS } from "@/lib/ease";
import { cn } from "@/lib/utils";

export interface NumberTickerProps {
  value: number;
  pad?: number;
  duration?: number;
  stagger?: number;
  startOnView?: boolean;
  prefix?: string;
  suffix?: string;
  blur?: boolean;
  className?: string;
  digitClassName?: string;
  locale?: boolean;
  format?: (value: number) => string;
}

const DIGIT_HEIGHT_EM = 1.1;
const DIGITS = Array.from({ length: 10 }, (_, n) => n);

export function NumberTicker({
  value,
  pad,
  duration = 0.32,
  stagger = 0,
  prefix,
  suffix,
  className,
  digitClassName,
  locale,
  format,
}: NumberTickerProps) {
  const text = useMemo(() => {
    const rounded = Math.round(value);
    const formatted = format
      ? format(rounded)
      : locale
        ? rounded.toLocaleString()
        : rounded.toString();
    return pad ? formatted.padStart(pad, "0") : formatted;
  }, [value, pad, format, locale]);
  const glyphs = useMemo(() => {
    const chars = text.split("");
    return chars.map((char, i) => ({ char, id: `g-${chars.length - 1 - i}` }));
  }, [text]);
  const readableText = `${prefix ?? ""}${text}${suffix ?? ""}`;

  return (
    <span className={cn("inline-flex items-center tabular-nums", className)}>
      <span className="sr-only">{readableText}</span>
      <span aria-hidden="true" className="inline-flex items-center">
        {prefix ? <span>{prefix}</span> : null}
        {glyphs.map(({ char, id }, i) => {
          if (!/\d/.test(char)) {
            return (
              <span key={id} className="inline-flex h-[1.1em] items-center">
                {char}
              </span>
            );
          }
          return (
            <Digit
              key={id}
              digit={Number(char)}
              delay={i * stagger}
              duration={duration}
              className={digitClassName}
            />
          );
        })}
        {suffix ? <span>{suffix}</span> : null}
      </span>
    </span>
  );
}

function Digit({
  digit,
  delay,
  duration,
  className,
}: {
  digit: number;
  delay: number;
  duration: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <span
      className={cn("relative inline-block overflow-hidden", className)}
      style={{ height: `${DIGIT_HEIGHT_EM}em`, width: "0.72em" }}
    >
      <span
        className="absolute inset-x-0 top-0 flex flex-col items-center"
        style={{
          transform: `translateY(-${digit * DIGIT_HEIGHT_EM}em)`,
          transition: reduce
            ? "none"
            : `transform ${duration}s ${delay}s ${EASE_OUT_CSS}`,
        }}
      >
        {DIGITS.map((n) => (
          <span
            key={n}
            className="flex h-[1.1em] items-center justify-center leading-none"
          >
            {n}
          </span>
        ))}
      </span>
    </span>
  );
}
