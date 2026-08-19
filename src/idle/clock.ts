import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

type Pulse = () => void;

const pulses = new Set<Pulse>();
let rafId = 0;
let lastSecond = -1;

function beat() {
  for (const pulse of pulses) {
    pulse();
  }
}

function loop() {
  rafId = window.requestAnimationFrame(loop);
  const second = Math.floor(Date.now() / 1000);
  if (second === lastSecond) {
    return;
  }
  lastSecond = second;
  beat();
}

function startWallClock() {
  if (rafId) {
    return;
  }
  rafId = window.requestAnimationFrame(loop);
  window.addEventListener("bloop-tick", beat);
  void listen("island-tick", beat);
}

function subscribeWallClock(pulse: Pulse) {
  startWallClock();
  pulses.add(pulse);
  pulse();
  return () => {
    pulses.delete(pulse);
  };
}

export function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    return subscribeWallClock(() => setNow(new Date()));
  }, []);
  return now;
}

export function useNowMs(enabled = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) {
      return;
    }
    return subscribeWallClock(() => setNow(Date.now()));
  }, [enabled]);
  return now;
}

export function formatIdleDate(now: Date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);
}

export function wallParts(now: Date) {
  return {
    hours: now.getHours(),
    minutes: now.getMinutes(),
    seconds: now.getSeconds(),
  };
}
