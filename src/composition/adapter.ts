import type { ActivitySnapshot } from "@/lib/engine/types";
import type {
  ActivitySemantics,
  Density,
  Lifecycle,
  VariantCost,
} from "./types.ts";

/** Map a backend ActivitySnapshot onto the solver's semantic model. */
export function semanticsFromSnapshot(
  snapshot: ActivitySnapshot,
): ActivitySemantics {
  const attention = snapshot.attention;
  return {
    activityId: snapshot.activityId,
    pluginId: snapshot.pluginId,
    lifecycle: (snapshot.lifecycle ?? "ongoing") as Lifecycle,
    importance: attention?.importance ?? 0.5,
    urgency: attention?.urgency ?? 0.33,
    freshnessMs: attention?.freshnessMs ?? null,
    urgencyWindowMs: attention?.urgencyWindowMs ?? null,
    persistence: attention?.persistence ?? 0.5,
    interruptible: attention?.interruptible ?? true,
    takeoverSuitable: attention?.takeoverSuitable ?? false,
    deadlineMs: snapshot.deadlineMs ?? null,
    lifetimeMs: snapshot.lifetimeMs ?? null,
    timestampMs: snapshot.timestampMs ?? 0,
    variants: (snapshot.variants ?? []).map(variantFromSnapshot),
  };
}

export function variantFromSnapshot(variant: {
  density: Density;
  minWidth?: number;
  preferredWidth: number;
  maxWidth?: number | null;
  utility?: number;
  minReadableMs?: number | null;
  coexist?: boolean;
}): VariantCost {
  const preferred = Math.max(0, variant.preferredWidth || 0);
  const minWidth = Math.max(0, variant.minWidth ?? 0);
  return {
    density: variant.density,
    minWidth,
    preferredWidth: Math.max(minWidth, preferred),
    maxWidth: variant.maxWidth ?? null,
    utility: variant.utility ?? 0.5,
    coexist: variant.coexist ?? true,
    minReadableMs: variant.minReadableMs ?? null,
  };
}
