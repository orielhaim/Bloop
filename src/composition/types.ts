/** Semantic density levels. Names are information density, not pixel widths. */
export type Density =
  | "micro"
  | "small"
  | "compact"
  | "richCompact"
  | "expanded";

export type Lifecycle =
  | "momentary"
  | "ongoing"
  | "progress"
  | "countdown"
  | "completion"
  | "alert";

export type CompositionPreference = "auto" | "minimal" | "rich";

/** Which closed-island face the engine selected. Replacement happens when this changes. */
export type FaceMode = "idle" | "resident" | "takeover";

/** The cost/utility a plugin declares for one presentation variant. */
export interface VariantCost {
  density: Density;
  minWidth: number;
  preferredWidth: number;
  maxWidth: number | null;
  /** Information utility 0..1. */
  utility: number;
  /** Whether this variant may sit alongside other segments. */
  coexist: boolean;
  /** Minimum readable duration before this variant may swap away (ms). */
  minReadableMs: number | null;
}

/** The semantic face of an Activity the engine reasons about. */
export interface ActivitySemantics {
  activityId: string;
  pluginId: string;
  lifecycle: Lifecycle;
  importance: number;
  /** Base urgency 0..1. */
  urgency: number;
  /** Freshness window (ms); null = resident. */
  freshnessMs: number | null;
  /** Window before deadline during which urgency ramps to 1.0. */
  urgencyWindowMs: number | null;
  persistence: number;
  interruptible: boolean;
  takeoverSuitable: boolean;
  /** Absolute wall-clock deadline (ms since epoch). */
  deadlineMs: number | null;
  /** Transient window (ms); legacy alias for freshness. */
  lifetimeMs: number | null;
  /** Publish timestamp (ms since epoch). */
  timestampMs: number;
  variants: VariantCost[];
}

export interface SpatialBudget {
  /** Hard ceiling for the closed island width (px). */
  maxWidth: number;
  /** Resting clock width (px). */
  baseWidth: number;
  /** Gap between segments (px). */
  gap: number;
  /** Horizontal shell padding (px). */
  paddingX: number;
  restingHeight: number;
  peekHeight: number;
  presentationHeight: number;
  preference: CompositionPreference;
}

/** One chosen segment in a composition. */
export interface CompositionSegment {
  /** Stable render key. */
  key: string;
  /** Activity identity, stable across variants for FLIP morphing. */
  id: string;
  activityId: string;
  pluginId: string;
  density: Density;
  width: number;
  utility: number;
  /** Scored value (after width cost, before continuity). */
  score: number;
  relevance: number;
  urgencyNow: number;
  /** Engine-owned overflow affordance flag. */
  overflow?: boolean;
}

export interface Composition {
  /** Resident segments, in visual order. Always planned, even during takeover. */
  segments: CompositionSegment[];
  /** A takeover transient overlay (volume, timer finished). */
  transient: CompositionSegment | null;
  /** How many relevant Activities are hidden behind the overflow affordance. */
  hidden: number;
  /** Authoritative closed-island shell width (content + padding). */
  width: number;
  /** Authoritative closed-island shell height. */
  height: number;
  /** Derived closed-island presence. */
  presence: "resting" | "peek" | "presentation";
  /** Occupying face. FaceSwap must key on `faceKey`, not plugin internals. */
  faceMode: FaceMode;
  faceKey: string;
}

/** One explanation entry for developer diagnostics. */
export interface CompositionDiagnostic {
  activityId: string;
  relevance: number;
  urgencyNow: number;
  freshness: number;
  chosen: Density | null;
  score: number;
  widthCost: number;
  continuity: number;
  reason: string;
}

/** Stable memory the engine uses for continuity / hysteresis across solves. */
export interface CompositionMemory {
  /** activityId -> density that was visible last solve. */
  last: Record<string, Density>;
  /** activityId -> first-seen wall time (for dwell enforcement). */
  firstSeen: Record<string, number>;
  /** activityId -> last interaction wall time. */
  interacted: Record<string, number>;
  /** activityId -> running relevance average (smoothing). */
  average: Record<string, number>;
  /** Last closed-island shell width, for hysteresis. */
  shellWidth?: number;
  /** Last closed-island shell height, for hysteresis. */
  shellHeight?: number;
}

export function emptyMemory(): CompositionMemory {
  return { last: {}, firstSeen: {}, interacted: {}, average: {} };
}

export const IDLE_FACE_KEY = "idle";
export const RESIDENT_FACE_KEY = "resident";

export function takeoverFaceKey(activityId: string) {
  return `takeover:${activityId}`;
}
