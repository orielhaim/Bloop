import { useEffect, useState } from "react";

export function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timeout = 0;
    const schedule = () => {
      const date = new Date();
      setNow(date);
      const wait = (60 - date.getSeconds()) * 1000 - date.getMilliseconds();
      timeout = window.setTimeout(schedule, Math.max(250, wait));
    };
    schedule();
    return () => window.clearTimeout(timeout);
  }, []);
  return now;
}

export function formatIdleTime(now: Date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
}

export function formatIdleDate(now: Date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);
}
