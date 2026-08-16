import { Feedback } from "@dnd-kit/dom";
import {
  DragDropProvider,
  type DragMoveEvent,
  type DragOverEvent,
  DragOverlay,
} from "@dnd-kit/react";
import { isSortable } from "@dnd-kit/react/sortable";
import { motion } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FiCheck, FiEdit2 } from "react-icons/fi";
import {
  ActivityIcon,
  ActivityTray,
  applyHomeDrag,
  dropIndex,
  HomeStrip,
  hoverHomeLayout,
  isIslandDropTarget,
  placeActivity,
  removeActivity,
} from "@/activities/home";
import { ActivityView, nodeForPresence } from "@/activities/renderer";
import { applyTheme } from "@/animation/tokens";
import { IdleFace, occupiesIslandFace } from "@/idle/face";
import { engine } from "@/lib/engine";
import { catalogItem, normalizeLayout } from "@/lib/engine/layout";
import type {
  ActivitySnapshot,
  HomeLayout,
  IdleProvider,
} from "@/lib/engine/types";
import {
  expandedIsland,
  islandWindow,
  metricsFor,
  type Presence,
} from "./metrics";
import { useIsland } from "./presence";

const trayHit = 96;

function centerLeft(width: number) {
  return (islandWindow.width - width) / 2;
}

function expandedWidth(count: number) {
  if (count <= 1) {
    return expandedIsland.width;
  }
  return Math.min(
    islandWindow.width - 16,
    expandedIsland.width + (count - 1) * 132,
  );
}

function shellMorph(reduced: boolean, collapsing: boolean) {
  if (reduced) {
    return { duration: 0.08 };
  }
  const duration = collapsing ? 0.22 : 0.38;
  const ease = collapsing
    ? ([0.32, 0.0, 0.2, 1] as const)
    : ([0.16, 1, 0.3, 1] as const);
  return {
    width: { type: "tween" as const, duration, ease },
    height: {
      type: "tween" as const,
      duration: collapsing ? 0.24 : 0.42,
      ease,
    },
    borderBottomLeftRadius: { type: "tween" as const, duration, ease },
    borderBottomRightRadius: { type: "tween" as const, duration, ease },
  };
}

function sameItems(left: HomeLayout | null, right: HomeLayout | null) {
  if (left === right) {
    return true;
  }
  if (!left || !right || left.items.length !== right.items.length) {
    return false;
  }
  return left.items.every((id, index) => id === right.items[index]);
}

function sourceActivityId(sourceId: string) {
  return sourceId.startsWith("tray:") ? sourceId.slice(5) : sourceId;
}

function dropZone(
  point: { x: number; y: number } | undefined,
  shell: DOMRect | undefined,
): "home" | "tray" | null {
  if (!point || !shell) {
    return null;
  }
  if (point.x < shell.left || point.x > shell.right) {
    return null;
  }
  if (point.y >= shell.top && point.y < shell.bottom) {
    return "home";
  }
  if (point.y >= shell.bottom) {
    return "tray";
  }
  return null;
}

export function Island() {
  const {
    presence,
    occupant,
    state,
    settings,
    theme,
    catalog,
    customizing,
    setCustomizing,
    open,
    updateLayout,
  } = useIsland();
  const reduced =
    settings.reducedMotion ??
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const snapshot = occupant ?? state?.activity ?? null;
  const activities = state?.activities ?? [];
  const occupying = occupiesIslandFace(snapshot);
  const layout = normalizeLayout(settings.layout);
  const [hoverLayout, setHoverLayout] = useState<HomeLayout | null>(null);
  const [holdSize, setHoldSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const displayLayout = hoverLayout ?? layout;
  const expanded = presence === "expanded";
  const shellWidth = expanded
    ? expandedWidth(displayLayout.items.length)
    : metricsFor(presence).width;
  const fallback = metricsFor(presence);
  const [size, setSize] = useState<{ width: number; height: number }>({
    width: fallback.width,
    height: fallback.height,
  });
  const shown = holdSize ?? size;
  const measureRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const measureKey = `${presence}:${snapshot?.activityId ?? ""}:${JSON.stringify(settings.idleProvider)}:${displayLayout.items.join(",")}:${customizing}`;
  const collapsing = presence === "resting";
  const morph = shellMorph(reduced, collapsing);

  useLayoutEffect(() => {
    void measureKey;
    const node = measureRef.current;
    if (!node) {
      return;
    }
    const update = () => {
      const next = {
        width: expanded ? shellWidth : Math.ceil(node.scrollWidth),
        height: Math.ceil(node.scrollHeight),
      };
      setSize((current) =>
        current.width === next.width && current.height === next.height
          ? current
          : next,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [expanded, measureKey, shellWidth]);

  useEffect(() => {
    const hitWidth = expanded ? islandWindow.width : shown.width;
    const hitHeight = customizing ? shown.height + trayHit : shown.height;
    void engine.windows.setPresence(presence, hitWidth, hitHeight);
  }, [customizing, expanded, presence, shown.height, shown.width]);

  applyTheme(theme);

  const left = centerLeft(shown.width);
  const radius = expanded ? 28 : Math.max(16, Math.round(shown.height / 2));
  const chromeDelay = reduced ? 0 : 0.08;
  const shellStyle = useMemo(
    () => ({
      background: theme.tokens.shell,
      color: theme.tokens.foreground,
      boxShadow: theme.tokens.shadow,
    }),
    [theme],
  );
  const fade = reduced
    ? { duration: 0 }
    : { duration: 0.16, ease: [0.22, 1, 0.36, 1] as const };

  const previewFromDrag = (event: DragOverEvent | DragMoveEvent) => {
    const source = event.operation.source;
    if (!source) {
      setHoverLayout(null);
      return;
    }
    const point = event.operation.position.current;
    const zone =
      dropZone(point, shellRef.current?.getBoundingClientRect()) ??
      (isIslandDropTarget(event.operation.target?.id)
        ? "home"
        : String(event.operation.target?.id ?? "") === "tray"
          ? "tray"
          : null);
    const targetId = zone;
    const index = isSortable(source)
      ? source.index
      : dropIndex(layout, targetId, layout.items.length);
    const next = hoverHomeLayout(layout, String(source.id), index, targetId);
    setHoverLayout((current) => (sameItems(current, next) ? current : next));
  };

  return (
    <DragDropProvider
      plugins={(defaults) =>
        defaults.map((entry) =>
          entry === Feedback
            ? Feedback.configure({ feedback: "none", dropAnimation: null })
            : entry,
        )
      }
      onDragStart={(event) => {
        const sourceId = String(event.operation.source?.id ?? "");
        setDragId(sourceId ? sourceActivityId(sourceId) : null);
        if (sourceId && !sourceId.startsWith("tray:")) {
          setHoldSize(size);
        }
      }}
      onDragOver={previewFromDrag}
      onDragMove={previewFromDrag}
      onDragEnd={(event) => {
        const source = event.operation.source;
        const point = event.operation.position.current;
        const zone =
          dropZone(point, shellRef.current?.getBoundingClientRect()) ??
          (isIslandDropTarget(event.operation.target?.id)
            ? "home"
            : String(event.operation.target?.id ?? "") === "tray"
              ? "tray"
              : null);
        setHoverLayout(null);
        setHoldSize(null);
        setDragId(null);
        if (event.canceled || !source) {
          return;
        }
        const sourceId = String(source.id);
        if (sourceId.startsWith("tray:") && zone !== "home") {
          return;
        }
        if (
          !sourceId.startsWith("tray:") &&
          zone !== "home" &&
          zone !== "tray"
        ) {
          return;
        }
        const next = applyHomeDrag(
          layout,
          sourceId,
          isSortable(source)
            ? source.index
            : dropIndex(layout, zone, layout.items.length),
          zone,
        );
        if (next) {
          updateLayout(next);
        }
      }}
    >
      <div className="island-stage">
        <div
          ref={measureRef}
          className={`island-body island-measure ${presence}`}
          style={{
            width: expanded ? shellWidth : undefined,
            minWidth: expanded
              ? shellWidth
              : presence === "resting"
                ? 110
                : occupying
                  ? 220
                  : undefined,
            maxWidth: expanded ? shellWidth : 340,
          }}
        >
          <IslandFace
            presence={presence}
            snapshot={snapshot}
            activities={activities}
            idleProvider={settings.idleProvider}
            layout={displayLayout}
            committed={layout}
            catalog={catalog}
            customizing={customizing}
            interactive={false}
            reduced={reduced}
            onLayout={updateLayout}
          />
        </div>
        <div className="island-anchor">
          <motion.div
            ref={shellRef}
            initial={false}
            animate={{
              width: shown.width,
              height: shown.height,
              borderBottomLeftRadius: radius,
              borderBottomRightRadius: radius,
            }}
            transition={morph}
            className="island-shell"
            style={shellStyle}
            onClick={() => {
              if (!expanded) {
                open();
              }
            }}
          >
            <div className="island-layers">
              <div
                className="island-layer island-layer-compact"
                style={{ pointerEvents: expanded ? "none" : "auto" }}
              >
                <div
                  className={`island-body ${presence === "expanded" ? "peek" : presence}`}
                >
                  <IslandFace
                    presence={presence === "expanded" ? "peek" : presence}
                    snapshot={snapshot}
                    activities={activities}
                    idleProvider={settings.idleProvider}
                    layout={layout}
                    committed={layout}
                    catalog={catalog}
                    customizing={false}
                    interactive={false}
                    reduced={reduced}
                    onLayout={updateLayout}
                  />
                </div>
              </div>
              <motion.div
                className="island-layer island-layer-expanded"
                initial={false}
                animate={{
                  opacity: expanded ? 1 : 0,
                  filter: expanded ? "blur(0px)" : "blur(6px)",
                }}
                transition={{
                  opacity: { ...fade, delay: 0 },
                  filter: {
                    duration: reduced ? 0 : 0.18,
                    ease: [0.22, 1, 0.36, 1],
                  },
                }}
                style={{ pointerEvents: expanded ? "auto" : "none" }}
              >
                <div className="island-body expanded">
                  <IslandFace
                    presence="expanded"
                    snapshot={snapshot}
                    activities={activities}
                    idleProvider={settings.idleProvider}
                    layout={displayLayout}
                    committed={layout}
                    catalog={catalog}
                    customizing={customizing}
                    interactive
                    onLayout={updateLayout}
                  />
                </div>
              </motion.div>
            </div>
          </motion.div>
        </div>
        <motion.button
          type="button"
          className="island-edit"
          initial={false}
          animate={{
            opacity: expanded ? 1 : 0,
            pointerEvents: expanded ? "auto" : "none",
          }}
          transition={{ ...fade, delay: expanded ? chromeDelay : 0 }}
          style={{
            left: left + shown.width + 8,
            top: 12,
            background: theme.tokens.shell,
            color: theme.tokens.foreground,
          }}
          aria-label={customizing ? "Done editing" : "Edit home"}
          onClick={(event) => {
            event.stopPropagation();
            setCustomizing((value) => !value);
          }}
        >
          {customizing ? <FiCheck size={16} /> : <FiEdit2 size={16} />}
        </motion.button>
        <motion.div
          className="activity-tray-slot"
          initial={false}
          animate={{
            opacity: expanded && customizing ? 1 : 0,
            pointerEvents: expanded && customizing ? "auto" : "none",
          }}
          transition={{
            ...fade,
            delay: expanded && customizing ? chromeDelay : 0,
          }}
          onPointerDown={(event) => event.stopPropagation()}
          style={{
            left,
            top: shown.height + 8,
            width: shown.width,
          }}
        >
          <ActivityTray
            catalog={catalog}
            layout={displayLayout}
            committed={layout}
            draggingId={dragId}
            onPlace={(activityId) =>
              updateLayout(placeActivity(layout, activityId))
            }
          />
        </motion.div>
        <DragOverlay className="drag-overlay" dropAnimation={null}>
          {(source) => {
            const item = catalogItem(
              catalog,
              sourceActivityId(String(source?.id ?? "")),
            );
            if (!item) {
              return null;
            }
            return (
              <div className="activity-chip is-overlay">
                <ActivityIcon name={item.name} src={item.iconUrl} />
              </div>
            );
          }}
        </DragOverlay>
      </div>
    </DragDropProvider>
  );
}

function IslandFace({
  presence,
  snapshot,
  activities,
  idleProvider,
  layout,
  committed,
  catalog,
  customizing,
  interactive = true,
  reduced = false,
  onLayout,
}: {
  presence: Presence;
  snapshot: ActivitySnapshot | null;
  activities: ActivitySnapshot[];
  idleProvider: IdleProvider;
  layout: HomeLayout;
  committed: HomeLayout;
  catalog: ReturnType<typeof useIsland>["catalog"];
  customizing: boolean;
  interactive?: boolean;
  reduced?: boolean;
  onLayout: (layout: HomeLayout) => void;
}) {
  const node = snapshot?.peek ?? nodeForPresence(snapshot, presence);
  if (presence === "expanded") {
    return (
      <div className="home-wrap">
        <HomeStrip
          layout={layout}
          committed={committed}
          catalog={catalog}
          customizing={customizing}
          interactive={interactive}
          onAction={(pluginId, actionId, payload) => {
            void engine.activities.action(pluginId, actionId, payload);
          }}
          onRemove={(activityId) =>
            onLayout(removeActivity(committed, activityId))
          }
        />
      </div>
    );
  }
  if (occupiesIslandFace(snapshot) && node && snapshot) {
    return (
      <div className={`face-live ${presence}`}>
        <ActivityView
          node={node}
          snapshot={snapshot}
          onAction={(actionId, payload) => {
            void engine.activities.action(
              snapshot.pluginId,
              actionId,
              payload,
            );
          }}
        />
      </div>
    );
  }
  return (
    <IdleFace
      presence={presence}
      provider={idleProvider}
      activities={activities}
      catalog={catalog}
      reduced={reduced}
    />
  );
}
