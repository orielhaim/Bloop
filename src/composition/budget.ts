import type { SpatialBudget } from "./types.ts";

/**
 * The closed island's spatial budget, derived from the available window
 * geometry, DPI, and composition preference. Not a magic constant: it scales
 * with the window and exposes safe ergonomic limits.
 */
export function computeBudget(input: {
  windowWidth: number;
  dpr: number;
  preference: "auto" | "minimal" | "rich";
}): SpatialBudget {
  const { windowWidth, dpr, preference } = input;
  const usable = windowWidth - 32;
  const maxWidth = Math.round(
    Math.min(520, Math.max(240, usable * (dpr >= 2 ? 0.92 : 0.86))),
  );
  return {
    maxWidth,
    baseWidth: 152,
    gap: 6,
    paddingX: 12,
    restingHeight: 36,
    peekHeight: 40,
    presentationHeight: 42,
    preference,
  };
}

export const DEFAULT_BUDGET: SpatialBudget = {
  maxWidth: 360,
  baseWidth: 152,
  gap: 6,
  paddingX: 12,
  restingHeight: 36,
  peekHeight: 40,
  presentationHeight: 42,
  preference: "auto",
};
