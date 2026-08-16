export type UiNode = Record<string, unknown>;

export function text(value: string, variant = "body"): UiNode {
  return { kind: "text", text: value, variant };
}

export function secondaryText(value: string): UiNode {
  return { kind: "secondaryText", text: value };
}

export function icon(name: string): UiNode {
  return { kind: "icon", name };
}

export function artwork(src: string, alt = "Artwork"): UiNode {
  return { kind: "artwork", src, alt };
}

export function progress(value: number, max = 1): UiNode {
  return { kind: "progress", value, max };
}

export function iconButton(id: string, iconName: string, label: string): UiNode {
  return { kind: "iconButton", id, icon: iconName, label };
}

export function seekBar(
  positionMs: number,
  durationMs: number,
  action = "seek",
): UiNode {
  return { kind: "seekBar", positionMs, durationMs, action };
}

export function row(children: UiNode[], gap = 8): UiNode {
  return { kind: "row", children, gap, align: "center" };
}

export function column(children: UiNode[], gap = 8): UiNode {
  return { kind: "column", children, gap };
}

export function badge(value: string): UiNode {
  return { kind: "badge", text: value };
}

export type PreferredSize = "auto" | "compact" | "medium" | "wide";

export function snapshot(input: {
  activityId: string;
  pluginId: string;
  priority?: number;
  mode?: string;
  compact?: UiNode | null;
  peek?: UiNode | null;
  presentation?: UiNode | null;
  expanded?: UiNode | null;
  timestampMs: number;
  lifetimeMs?: number | null;
  coalescingKey?: string | null;
  preferredSize?: PreferredSize | null;
}) {
  return {
    activityId: input.activityId,
    pluginId: input.pluginId,
    priority: input.priority ?? 40,
    mode: input.mode ?? "compact",
    lifetimeMs: input.lifetimeMs ?? null,
    interruptible: true,
    compact: input.compact ?? null,
    peek: input.peek ?? null,
    presentation: input.presentation ?? null,
    expanded: input.expanded ?? null,
    timestampMs: input.timestampMs,
    coalescingKey: input.coalescingKey ?? null,
    preferredSize: input.preferredSize ?? null,
  };
}
