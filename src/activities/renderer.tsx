import {
  Bell,
  Bluetooth,
  Gamepad2,
  Headphones,
  Keyboard,
  Mouse,
  Pause,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  Shuffle,
  SkipBack,
  SkipForward,
  Smartphone,
  Speaker,
  Timer,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import { type CSSProperties, useEffect, useState } from "react";
import { UiCountdown } from "@/components/timer/digits";
import { WheelDurationPicker } from "@/components/timer/wheel-duration";
import { engine } from "@/lib/engine";
import type { ActivitySnapshot, UiNode } from "@/lib/engine/types";
import { cn } from "@/lib/utils";

const icons = {
  pause: Pause,
  play: Play,
  "skip-back": SkipBack,
  "skip-forward": SkipForward,
  shuffle: Shuffle,
  repeat: Repeat,
  "rotate-ccw": RotateCcw,
  volume: Volume2,
  "volume-mid": Volume1,
  "volume-x": VolumeX,
  bluetooth: Bluetooth,
  headphones: Headphones,
  speaker: Speaker,
  keyboard: Keyboard,
  mouse: Mouse,
  gamepad: Gamepad2,
  smartphone: Smartphone,
  timer: Timer,
  plus: Plus,
  x: X,
  bell: Bell,
};

const fillTransition = {
  duration: 0.18,
  ease: [0.22, 1, 0.36, 1] as const,
};

export function ActivityView({
  node,
  snapshot,
  onAction,
}: {
  node: UiNode;
  snapshot: ActivitySnapshot;
  onAction: (id: string, payload?: string) => void;
}) {
  return <Node node={node} snapshot={snapshot} onAction={onAction} />;
}

function Node({
  node,
  snapshot,
  onAction,
}: {
  node: UiNode;
  snapshot: ActivitySnapshot;
  onAction: (id: string, payload?: string) => void;
}) {
  switch (node.kind) {
    case "text":
      return <span className={cn("ui-text", node.variant)}>{node.text}</span>;
    case "secondaryText":
      return <span className="ui-secondary">{node.text}</span>;
    case "icon": {
      const Icon = icons[node.name as keyof typeof icons];
      if (Icon) {
        return (
          <span className="ui-symbol" aria-hidden>
            <Icon size={17} strokeWidth={1.9} />
          </span>
        );
      }
      return <span className="ui-badge">{node.name}</span>;
    }
    case "badge":
      return <span className="ui-badge">{node.text}</span>;
    case "separator":
      return <span className="ui-separator" />;
    case "spacer":
      return (
        <span
          className={cn("ui-spacer", node.grow && "grow")}
          style={
            node.grow
              ? undefined
              : { width: node.size ?? 8, height: node.size ?? 8 }
          }
        />
      );
    case "waveform":
      return <Waveform active={Boolean(node.active)} />;
    case "progress":
      return (
        <span className="ui-progress">
          <motion.span
            className="ui-progress-fill"
            initial={{ width: 0 }}
            animate={{
              width: `${Math.min(100, ((node.value ?? 0) / (node.max ?? 1)) * 100)}%`,
            }}
            transition={fillTransition}
          />
        </span>
      );
    case "countdown":
      return (
        <UiCountdown
          deadlineMs={node.deadlineMs}
          running={node.running ?? true}
          pausedRemainingMs={node.pausedRemainingMs ?? null}
          totalMs={node.totalMs ?? null}
          onAction={onAction}
        />
      );
    case "ruler":
      return (
        <WheelDurationPicker
          valueMs={node.valueMs ?? 5 * 60_000}
          minMs={node.minMs ?? 5_000}
          maxMs={node.maxMs ?? 3 * 60 * 60 * 1000}
          onCommit={(value) => onAction(node.action, String(value))}
        />
      );
    case "seekBar":
      return (
        <SeekBar
          positionMs={node.positionMs}
          durationMs={node.durationMs}
          timestampMs={snapshot.timestampMs}
          playing={mediaPlaying(snapshot)}
          onSeek={(position) =>
            onAction(node.action, JSON.stringify({ positionMs: position }))
          }
        />
      );
    case "artwork":
    case "image":
      return <Artwork src={node.src} alt={"alt" in node ? node.alt : ""} />;
    case "iconButton": {
      const Icon = icons[node.icon as keyof typeof icons];
      return (
        <button
          type="button"
          className={cn("ui-icon-button", node.size)}
          aria-label={node.label || node.icon}
          onClick={(event) => {
            event.stopPropagation();
            onAction(node.id);
          }}
        >
          {Icon ? (
            <Icon size={node.size === "lg" ? 22 : 16} strokeWidth={1.75} />
          ) : (
            node.icon
          )}
        </button>
      );
    }
    case "button":
      return (
        <button
          type="button"
          className="ui-button"
          onClick={(event) => {
            event.stopPropagation();
            onAction(node.id);
          }}
        >
          {node.label}
        </button>
      );
    case "toggle":
      return (
        <button
          type="button"
          className={cn("ui-toggle", node.on && "on")}
          aria-pressed={node.on}
          onClick={(event) => {
            event.stopPropagation();
            onAction(node.id, String(!node.on));
          }}
        >
          {node.label}
        </button>
      );
    case "row":
      return (
        <div
          className={cn("ui-row", node.align)}
          style={{ gap: node.gap ?? 8 }}
        >
          {(node.children ?? []).map((child, index) => (
            <Node
              key={index}
              node={child}
              snapshot={snapshot}
              onAction={onAction}
            />
          ))}
        </div>
      );
    case "column":
      return (
        <div className="ui-column" style={{ gap: node.gap ?? 8 }}>
          {(node.children ?? []).map((child, index) => (
            <Node
              key={index}
              node={child}
              snapshot={snapshot}
              onAction={onAction}
            />
          ))}
        </div>
      );
    case "stack":
      return (
        <div className="ui-stack">
          {(node.children ?? []).map((child, index) => (
            <Node
              key={index}
              node={child}
              snapshot={snapshot}
              onAction={onAction}
            />
          ))}
        </div>
      );
    default:
      return null;
  }
}

function Waveform({ active }: { active: boolean }) {
  return (
    <div className={cn("waveform", active && "is-active")} aria-hidden>
      {[0.45, 0.9, 0.6, 1, 0.7].map((level) => (
        <span
          key={level}
          className="waveform-bar"
          style={{ "--level": level } as CSSProperties}
        />
      ))}
    </div>
  );
}

const artworkCache = new Map<string, string>();

function Artwork({ src, alt }: { src: string; alt?: string }) {
  const [resolved, setResolved] = useState<string | null>(() => {
    if (!src.startsWith("media:")) {
      return src;
    }
    return artworkCache.get(src) ?? null;
  });

  useEffect(() => {
    let cancelled = false;
    if (!src.startsWith("media:")) {
      setResolved(src);
      return;
    }
    const cached = artworkCache.get(src);
    if (cached) {
      setResolved(cached);
      return;
    }
    const sessionId = src.slice("media:".length).split("::")[0] ?? "";
    void engine.media.artwork(sessionId).then((url) => {
      if (url) {
        artworkCache.set(src, url);
      }
      if (!cancelled) {
        setResolved(url);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (!resolved) {
    return <span className="ui-art fallback" />;
  }
  return (
    <img className="ui-art" src={resolved} alt={alt || ""} draggable={false} />
  );
}

function SeekBar({
  positionMs,
  durationMs,
  timestampMs,
  playing,
  onSeek,
}: {
  positionMs: number;
  durationMs: number;
  timestampMs: number;
  playing: boolean;
  onSeek: (position: number) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [scrub, setScrub] = useState<number | null>(null);
  useEffect(() => {
    setScrub(null);
  }, [positionMs, timestampMs]);
  useEffect(() => {
    if (!playing || scrub != null) {
      return;
    }
    let frame = 0;
    const loop = () => {
      setNow(Date.now());
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [playing, scrub]);
  const origin = scrub ?? positionMs;
  const elapsed = playing && scrub == null ? Math.max(0, now - timestampMs) : 0;
  const current = Math.min(durationMs, origin + elapsed);
  const remaining = Math.max(0, durationMs - current);
  const percent = durationMs === 0 ? 0 : (current / durationMs) * 100;

  return (
    <div className="ui-seek-row">
      <span className="ui-time">{formatClock(current)}</span>
      <button
        type="button"
        className="ui-seek"
        aria-label="Seek"
        onClick={(event) => {
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          const ratio = Math.min(
            1,
            Math.max(0, (event.clientX - rect.left) / rect.width),
          );
          const next = Math.round(ratio * durationMs);
          setScrub(next);
          onSeek(next);
        }}
      >
        <span className="ui-seek-fill" style={{ width: `${percent}%` }} />
      </button>
      <span className="ui-time">-{formatClock(remaining)}</span>
    </div>
  );
}

function formatClock(ms: number) {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function mediaPlaying(snapshot: ActivitySnapshot): boolean {
  if (waveformActive(snapshot.expanded) || waveformActive(snapshot.preview)) {
    return true;
  }
  return (snapshot.variants ?? []).some((variant) =>
    waveformActive(variant.node),
  );
}

function waveformActive(node: UiNode | null | undefined): boolean {
  if (!node) {
    return false;
  }
  if (node.kind === "waveform") {
    return Boolean(node.active);
  }
  if ("children" in node) {
    return (node.children ?? []).some((child) => waveformActive(child));
  }
  return false;
}

/** Pick the node for a given density from an Activity's variants. */
export function variantNode(
  snapshot: ActivitySnapshot | null,
  density: "micro" | "small" | "compact" | "richCompact" | "expanded",
): UiNode | null {
  if (!snapshot) {
    return null;
  }
  if (density === "expanded") {
    return snapshot.expanded ?? null;
  }
  const variant = (snapshot.variants ?? []).find(
    (item) => item.density === density,
  );
  return variant?.node ?? null;
}

export function findUiNode(
  node: UiNode | null | undefined,
  kind: UiNode["kind"],
): UiNode | null {
  if (!node) {
    return null;
  }
  if (node.kind === kind) {
    return node;
  }
  if ("children" in node) {
    for (const child of node.children ?? []) {
      const found = findUiNode(child, kind);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

/** Prefer the richest available compact node for previews/home cards. */
export function previewNode(snapshot: ActivitySnapshot | null): UiNode | null {
  if (!snapshot) {
    return null;
  }
  const order: Array<"richCompact" | "compact" | "small" | "micro"> = [
    "richCompact",
    "compact",
    "small",
    "micro",
  ];
  for (const density of order) {
    const node = variantNode(snapshot, density);
    if (node) {
      return node;
    }
  }
  return snapshot.preview ?? null;
}
