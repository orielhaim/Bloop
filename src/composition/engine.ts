import {
  type ActivitySemantics,
  type Composition,
  type CompositionDiagnostic,
  type CompositionMemory,
  type CompositionSegment,
  IDLE_FACE_KEY,
  RESIDENT_FACE_KEY,
  type SpatialBudget,
  takeoverFaceKey,
  type VariantCost,
} from "./types.ts";
import {
  clamp01,
  freshnessFactor,
  interactionBoost,
  urgencyNow,
} from "./urgency.ts";

/**
 * Deterministic constraint solver. Plugins declare semantics and variant
 * costs; this module owns who is visible, at what density, how wide the
 * shell is, and whether the occupying face is replaced or composed.
 */

const CONTINUITY_BONUS = 16;
const DENSITY_CHANGE_BONUS = 5;
const DWELL_WINDOW_MS = 1_200;
const DWELL_BONUS = 13;
const REORDER_THRESHOLD = 13;
const HIDDEN_RELEVANCE_FLOOR = 0.16;
const OVERFLOW_WIDTH = 30;

export interface SolveInput {
  activities: ActivitySemantics[];
  budget: SpatialBudget;
  now: number;
  memory: CompositionMemory;
}

export interface SolveOutput {
  composition: Composition;
  diagnostics: CompositionDiagnostic[];
  memory: CompositionMemory;
}

export function allocatedWidth(variant: VariantCost): number {
  const preferred = Math.max(variant.minWidth, variant.preferredWidth);
  if (variant.maxWidth == null) {
    return preferred;
  }
  return Math.min(variant.maxWidth, preferred);
}

function widthCost(width: number, budget: SpatialBudget): number {
  const preference = budget.preference;
  const base = preference === "minimal" ? 7 : preference === "rich" ? 3.5 : 5;
  const w = Math.max(0, width) / 100;
  let cost = w ** 1.7 * base;
  if (width > 300) {
    cost += ((width - 300) / 100) ** 2 * 60;
  }
  return cost;
}

interface Choice {
  activity: ActivitySemantics;
  variant: VariantCost;
  score: number;
  relevance: number;
  urgencyNow: number;
  continuity: number;
  widthCost: number;
  width: number;
}

function bestChoice(
  activity: ActivitySemantics,
  budget: SpatialBudget,
  memory: CompositionMemory,
  now: number,
): { choices: Choice[]; relevance: number; freshness: number } {
  const relevance =
    activity.importance *
      (0.45 + 0.55 * urgencyNow(activity, now)) *
      (0.5 + 0.5 * clamp01(activity.persistence)) *
      freshnessFactor(activity, now) +
    interactionBoost(activity, memory.interacted, now);
  const freshness = freshnessFactor(activity, now);
  const lastDensity = memory.last[activity.activityId];
  const dwell =
    memory.firstSeen[activity.activityId] != null
      ? Math.max(
          0,
          DWELL_WINDOW_MS - (now - memory.firstSeen[activity.activityId]),
        )
      : 0;

  const choices = activity.variants.map((variant) => {
    const width = allocatedWidth(variant);
    const value = relevance * variant.utility * 100;
    const continuity =
      (lastDensity === variant.density
        ? CONTINUITY_BONUS
        : lastDensity != null
          ? DENSITY_CHANGE_BONUS
          : 0) + (dwell > 0 ? DWELL_BONUS * (dwell / DWELL_WINDOW_MS) : 0);
    const cost = widthCost(width, budget);
    return {
      activity,
      variant,
      score: value - cost + continuity,
      relevance,
      urgencyNow: urgencyNow(activity, now),
      continuity,
      widthCost: cost,
      width,
    };
  });
  return { choices, relevance, freshness };
}

function solveResident(
  activities: ActivitySemantics[],
  budget: SpatialBudget,
  memory: CompositionMemory,
  now: number,
): { chosen: Choice[]; hidden: string[] } {
  const prepared = activities
    .map((activity) => ({
      activity,
      ...bestChoice(activity, budget, memory, now),
    }))
    .filter((entry) => entry.relevance > 0 && entry.choices.length > 0);

  const best = {
    score: Number.NEGATIVE_INFINITY,
    width: 0,
    choices: [] as Choice[],
  };
  prepared.sort((a, b) => b.relevance - a.relevance);

  const maxWidth = budget.maxWidth - budget.paddingX * 2;

  const visit = (
    index: number,
    usedWidth: number,
    usedCount: number,
    score: number,
    acc: Choice[],
  ) => {
    if (usedWidth > maxWidth) {
      return;
    }
    if (score > best.score) {
      best.score = score;
      best.width = usedWidth;
      best.choices = acc;
    }
    if (index >= prepared.length) {
      return;
    }
    const { choices } = prepared[index];
    visit(index + 1, usedWidth, usedCount, score, acc);
    for (const choice of choices) {
      const addGap = usedCount > 0 ? budget.gap : 0;
      const nextWidth = usedWidth + choice.width + addGap;
      if (nextWidth > maxWidth) {
        continue;
      }
      if (!choice.variant.coexist && usedCount > 0) {
        continue;
      }
      visit(index + 1, nextWidth, usedCount + 1, score + choice.score, [
        ...acc,
        choice,
      ]);
    }
  };
  visit(0, 0, 0, 0, []);

  const shown = new Set(
    best.choices.map((choice) => choice.activity.activityId),
  );
  const hidden = prepared
    .filter((entry) => !shown.has(entry.activity.activityId))
    .filter((entry) => entry.relevance >= HIDDEN_RELEVANCE_FLOOR)
    .map((entry) => entry.activity.activityId);
  return { chosen: best.choices, hidden };
}

function pickTransient(
  activities: ActivitySemantics[],
  budget: SpatialBudget,
  now: number,
): {
  activity: ActivitySemantics;
  variant: VariantCost;
  score: number;
  width: number;
} | null {
  const maxWidth = budget.maxWidth - budget.paddingX * 2;
  let best: {
    activity: ActivitySemantics;
    variant: VariantCost;
    score: number;
    width: number;
  } | null = null;
  for (const activity of activities) {
    if (!activity.takeoverSuitable) {
      continue;
    }
    const freshness = freshnessFactor(activity, now);
    if (freshness <= 0 || activity.variants.length === 0) {
      continue;
    }
    const rel =
      activity.importance *
      (0.45 + 0.55 * urgencyNow(activity, now)) *
      (0.5 + 0.5 * clamp01(activity.persistence)) *
      freshness;
    const activityScore = rel * 100;
    let chosen: { variant: VariantCost; width: number } | null = null;
    for (const variant of activity.variants) {
      const width = allocatedWidth(variant);
      if (width > maxWidth) {
        continue;
      }
      if (
        !chosen ||
        variant.utility > chosen.variant.utility ||
        (variant.utility === chosen.variant.utility && width > chosen.width)
      ) {
        chosen = { variant, width };
      }
    }
    if (!chosen) {
      continue;
    }
    if (!best || activityScore > best.score) {
      best = {
        activity,
        variant: chosen.variant,
        score: activityScore,
        width: chosen.width,
      };
    }
  }
  return best;
}

function orderSegments(
  chosen: Choice[],
  order: string[],
): CompositionSegment[] {
  const prevOrder = new Map<string, number>();
  for (const [index, id] of order.entries()) {
    prevOrder.set(id, index);
  }

  const segments: CompositionSegment[] = chosen.map((choice) => ({
    key: choice.activity.activityId,
    id: choice.activity.activityId,
    activityId: choice.activity.activityId,
    pluginId: choice.activity.pluginId,
    density: choice.variant.density,
    width: choice.width,
    utility: choice.variant.utility,
    score: choice.score,
    relevance: choice.relevance,
    urgencyNow: choice.urgencyNow,
  }));

  const pair = (a: CompositionSegment, b: CompositionSegment) => {
    const ia = prevOrder.get(a.id);
    const ib = prevOrder.get(b.id);
    const scoreGap = Math.abs(a.score - b.score);
    if (ia != null && ib != null) {
      if (scoreGap > REORDER_THRESHOLD) {
        return b.score - a.score;
      }
      return ia - ib;
    }
    if (ia != null) {
      return scoreGap > REORDER_THRESHOLD ? b.score - a.score : -1;
    }
    if (ib != null) {
      return scoreGap > REORDER_THRESHOLD ? b.score - a.score : 1;
    }
    return b.score - a.score;
  };
  segments.sort(pair);
  return segments;
}

function overflowSegment(
  hidden: string[],
  count: number,
): CompositionSegment | null {
  if (count < 2 || hidden.length < 2) {
    return null;
  }
  return {
    key: "overflow",
    id: "overflow",
    activityId: "overflow",
    pluginId: "engine",
    density: "micro",
    width: OVERFLOW_WIDTH,
    utility: 0.1,
    score: 8,
    relevance: 0.1,
    urgencyNow: 0.1,
    overflow: true,
  };
}

function contentWidth(segments: CompositionSegment[], gap: number) {
  if (segments.length === 0) {
    return 0;
  }
  return (
    segments.reduce((sum, segment) => sum + segment.width, 0) +
    (segments.length - 1) * gap
  );
}

function shellWidth(content: number, budget: SpatialBudget) {
  return Math.round(content + budget.paddingX * 2);
}

export function solve(input: SolveInput): SolveOutput {
  const { activities, budget, now, memory } = input;
  const diagnostics: CompositionDiagnostic[] = [];
  const nextMemory: CompositionMemory = {
    last: {},
    firstSeen: { ...memory.firstSeen },
    interacted: { ...memory.interacted },
    average: { ...memory.average },
  };

  const takeover = pickTransient(activities, budget, now);
  const transient: CompositionSegment | null = takeover
    ? {
        key: takeover.activity.activityId,
        id: takeover.activity.activityId,
        activityId: takeover.activity.activityId,
        pluginId: takeover.activity.pluginId,
        density: takeover.variant.density,
        width: takeover.width,
        utility: takeover.variant.utility,
        score: takeover.score,
        relevance: takeover.activity.importance,
        urgencyNow: urgencyNow(takeover.activity, now),
      }
    : null;

  const residents = activities.filter(
    (activity) => activity.activityId !== takeover?.activity.activityId,
  );
  const { chosen, hidden } = solveResident(residents, budget, memory, now);
  const order = Object.keys(memory.last);
  let segments = orderSegments(chosen, order);
  const overflow = overflowSegment(hidden, hidden.length);
  if (overflow) {
    segments = [...segments, overflow];
  }

  let faceMode: Composition["faceMode"];
  let faceKey: string;
  let presence: Composition["presence"];
  let width: number;
  let height: number;

  if (transient) {
    faceMode = "takeover";
    faceKey = takeoverFaceKey(transient.activityId);
    presence = "presentation";
    width = shellWidth(transient.width, budget);
    height = budget.presentationHeight;
  } else if (segments.length > 0) {
    faceMode = "resident";
    faceKey = RESIDENT_FACE_KEY;
    presence = "peek";
    width = stabilizeDim(
      memory.shellWidth,
      shellWidth(contentWidth(segments, budget.gap), budget),
    );
    height = stabilizeDim(memory.shellHeight, budget.peekHeight, 4);
  } else {
    faceMode = "idle";
    faceKey = IDLE_FACE_KEY;
    presence = "resting";
    width = budget.baseWidth;
    height = budget.restingHeight;
  }

  const occupying = new Set(
    transient
      ? [transient.id]
      : segments
          .filter((segment) => !segment.overflow)
          .map((segment) => segment.id),
  );
  for (const segment of occupying.size
    ? transient
      ? [transient]
      : segments
    : []) {
    if (segment.overflow) {
      continue;
    }
    nextMemory.last[segment.id] = segment.density;
    if (nextMemory.firstSeen[segment.id] == null) {
      nextMemory.firstSeen[segment.id] = now;
    }
  }
  for (const activity of activities) {
    if (!occupying.has(activity.activityId)) {
      delete nextMemory.last[activity.activityId];
      if (memory.last[activity.activityId] != null) {
        delete nextMemory.firstSeen[activity.activityId];
      }
    }
  }

  for (const activity of activities) {
    const entry = bestChoice(activity, budget, memory, now);
    const chosenVariant = chosen.find(
      (choice) => choice.activity.activityId === activity.activityId,
    );
    const isTakeover = takeover?.activity.activityId === activity.activityId;
    let reason: string;
    if (isTakeover) {
      reason = "takeover face (engine replacement)";
    } else if (chosenVariant) {
      reason = `shown as ${chosenVariant.variant.density}`;
    } else if (entry.relevance < HIDDEN_RELEVANCE_FLOOR) {
      reason = "relevance below floor";
    } else {
      reason = hidden.includes(activity.activityId)
        ? "hidden (overflow)"
        : "no space / negative value";
    }
    diagnostics.push({
      activityId: activity.activityId,
      relevance: round(entry.relevance, 3),
      urgencyNow: round(urgencyNow(activity, now), 3),
      freshness: round(entry.freshness, 3),
      chosen: isTakeover
        ? (takeover?.variant.density ?? null)
        : (chosenVariant?.variant.density ?? null),
      score: round(chosenVariant?.score ?? 0, 2),
      widthCost: round(chosenVariant?.widthCost ?? 0, 2),
      continuity: round(chosenVariant?.continuity ?? 0, 2),
      reason,
    });
  }

  return {
    composition: {
      segments,
      transient,
      hidden: hidden.length,
      width,
      height,
      presence,
      faceMode,
      faceKey,
    },
    diagnostics,
    memory: { ...nextMemory, shellWidth: width, shellHeight: height },
  };
}

function stabilizeDim(previous: number | undefined, next: number, slack = 14) {
  if (previous == null || Math.abs(next - previous) >= slack) {
    return next;
  }
  return previous;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
