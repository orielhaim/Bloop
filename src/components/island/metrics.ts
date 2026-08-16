export const restingIsland = {
  width: 128,
  height: 32,
  radius: 16,
} as const;

export const peekIsland = {
  width: 220,
  height: 56,
  radius: 20,
} as const;

export const presentationIsland = {
  width: 332,
  height: 72,
  radius: 24,
} as const;

export const expandedIsland = {
  width: 360,
  height: 292,
  radius: 28,
} as const;

export const islandWindow = {
  width: 560,
  height: 520,
} as const;

export type Presence = "resting" | "peek" | "presentation" | "expanded";

export function metricsFor(presence: Presence) {
  switch (presence) {
    case "resting":
      return restingIsland;
    case "peek":
      return peekIsland;
    case "expanded":
      return expandedIsland;
    case "presentation":
      return presentationIsland;
  }
}
