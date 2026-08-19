import type { ActivitySemantics } from "./types.ts";

/** Smooth ramp from 0→1 over [0,1]. */
function ramp01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** Fraction of a freshness window that remains (1 fresh → 0 expired). */
export function freshnessFactor(
  activity: ActivitySemantics,
  now: number,
): number {
  const window = activity.freshnessMs ?? activity.lifetimeMs;
  if (window == null) {
    return 1;
  }
  const age = Math.max(0, now - activity.timestampMs);
  if (age >= window) {
    return 0;
  }
  const remaining = window - age;
  // Gentle curve: decays slowly at first, faster near the end.
  return ramp01(remaining / window);
}

/**
 * Dynamic urgency. When an Activity carries a deadline and an urgency window,
 * urgency ramps from its base value toward 1.0 as `now` approaches the
 * deadline. No plugin-specific thresholds live here: both the base and the ramp
 * shape come from generic semantic metadata.
 */
export function urgencyNow(activity: ActivitySemantics, now: number): number {
  const base = clamp01(activity.urgency);
  if (activity.deadlineMs == null || activity.urgencyWindowMs == null) {
    return base;
  }
  const remaining = activity.deadlineMs - now;
  if (remaining <= 0) {
    return 1;
  }
  const window = Math.max(1, activity.urgencyWindowMs);
  const t = ramp01(1 - remaining / window);
  return clamp01(base + (1 - base) * t);
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Composite relevance across the semantic dimensions. Importance sets a floor,
 * urgency and persistence scale it, freshness gates transients.
 */
export function relevance(activity: ActivitySemantics, now: number): number {
  const urgency = urgencyNow(activity, now);
  const persistence = clamp01(activity.persistence);
  const importance = clamp01(activity.importance);
  return (
    importance *
    (0.45 + 0.55 * urgency) *
    (0.5 + 0.5 * persistence) *
    freshnessFactor(activity, now)
  );
}

/** Recency-weighted interaction boost (0..1). Generically raises the
 * presentation value of an Activity the user just touched. */
export function interactionBoost(
  activity: ActivitySemantics,
  interacted: Record<string, number>,
  now: number,
): number {
  const at = interacted[activity.activityId];
  if (at == null) {
    return 0;
  }
  const age = Math.max(0, now - at);
  const WINDOW = 8_000;
  if (age >= WINDOW) {
    return 0;
  }
  return ramp01((WINDOW - age) / WINDOW) * 0.35;
}

/** Time until the activity's freshness window ends (ms), or null if resident. */
export function freshnessUntil(
  activity: ActivitySemantics,
  now: number,
): number | null {
  const window = activity.freshnessMs ?? activity.lifetimeMs;
  if (window == null) {
    return null;
  }
  return Math.max(0, activity.timestampMs + window - now);
}
