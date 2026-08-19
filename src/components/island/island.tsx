import { DragDropProvider } from "@dnd-kit/react";
import { isSortable } from "@dnd-kit/react/sortable";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FiCheck, FiEdit2 } from "react-icons/fi";
import {
  ActivityTray,
  dragActivityId,
  HOME_GROUP,
  HomeStrip,
  placeActivity,
  removeActivity,
  TRAY_GROUP,
} from "@/activities/home";
import { ActivityView, variantNode } from "@/activities/renderer";
import { applyTheme, motionFromTheme } from "@/animation/tokens";
import { IdleFace, idleFaceKey } from "@/idle/face";
import { engine } from "@/lib/engine";
import {
  canonicalItems,
  normalizeLayout,
  sameActivity,
} from "@/lib/engine/layout";
import type {
  ActivitySnapshot,
  ClockSettings,
  HomeLayout,
  IdleProvider,
} from "@/lib/engine/types";
import { fallbackSettings } from "@/lib/engine/types";
import { FaceSwap } from "./face-swap";
import { islandWindow, type Presence } from "./metrics";
import { useIsland } from "./presence";

function centerLeft(width: number) {
  return (islandWindow.width - width) / 2;
}

function shellMorph(
  reduced: boolean,
  presence: Presence,
  theme: Parameters<typeof motionFromTheme>[0],
) {
  const motion = motionFromTheme(theme, reduced);
  const spring =
    presence === "expanded"
      ? motion.expand
      : presence === "presentation"
        ? motion.peek
        : motion.collapse;
  return {
    width: spring,
    height: spring,
    borderBottomLeftRadius: spring,
    borderBottomRightRadius: spring,
  };
}

export function Island() {
  const {
    presence,
    composition,
    state,
    settings,
    theme,
    catalog,
    customizing,
    setCustomizing,
    open,
    updateLayout,
    markInteraction,
  } = useIsland();
  const reduced =
    settings.reducedMotion ??
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clock = settings.clock ?? fallbackSettings.clock;
  const activities = state?.activities ?? [];
  const committed = normalizeLayout(settings.layout);
  const layout = committed;
  const plan = composition.composition;
  const faceId =
    plan.faceMode === "idle"
      ? `idle:${idleFaceKey(settings.idleProvider, activities)}`
      : plan.faceKey;

  const [holdSize, setHoldSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const expanded = presence === "expanded";
  const [fit, setFit] = useState({ width: 120, height: 32 });
  const shown = holdSize ?? fit;
  const shellRef = useRef<HTMLDivElement>(null);
  const compactFitRef = useRef<HTMLDivElement>(null);
  const expandedFitRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  const morph = shellMorph(reduced, presence, theme);
  const layerMotion = motionFromTheme(theme, reduced);
  const expandKey = `${layout.items.join(",")}:${customizing}:${activities.map((item) => item.activityId).join(",")}:${faceId}:${clock.showSeconds}`;

  useLayoutEffect(() => {
    const node = expanded ? expandedFitRef.current : compactFitRef.current;
    if (!node) {
      return;
    }
    void expandKey;
    const apply = () => {
      const faces = node.querySelectorAll<HTMLElement>("[data-island-face]");
      const live = faces.item(faces.length - 1) ?? node;
      const padX = expanded ? 0 : 32;
      const padY = expanded ? 0 : 20;
      const height = Math.max(32, Math.ceil(live.scrollHeight) + padY);
      if (!expanded && plan.faceMode === "takeover") {
        const width = Math.max(228, Math.min(280, (plan.width || 196) + 32));
        setFit((current) =>
          current.width === width && current.height === height
            ? current
            : { width, height },
        );
        return;
      }
      const width = Math.max(
        72,
        Math.min(islandWindow.width - 16, Math.ceil(live.scrollWidth) + padX),
      );
      setFit((current) => {
        if (
          Math.abs(current.width - width) < 2 &&
          Math.abs(current.height - height) < 2
        ) {
          return current;
        }
        return { width, height };
      });
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    return () => observer.disconnect();
  }, [expandKey, expanded, plan.faceMode, plan.width]);

  useEffect(() => {
    const hitWidth = shown.width + (expanded ? 44 : 0);
    const hitHeight = shown.height + (expanded && customizing ? 64 : 0);
    void engine.windows.setPresence(presence, hitWidth, hitHeight);
  }, [customizing, expanded, presence, shown.height, shown.width]);

  applyTheme(theme);

  const left = centerLeft(shown.width);
  // Closed states stay moderately rounded, not pill-shaped: resting keeps a
  // small radius, peek/presentation grow slightly, expanded is a panel.
  const radius = expanded
    ? 28
    : presence === "resting"
      ? Math.round(Math.min(14, Math.max(10, shown.height * 0.4)))
      : presence === "peek"
        ? Math.round(Math.min(20, Math.max(12, shown.height * 0.36)))
        : Math.round(Math.min(22, Math.max(14, shown.height * 0.32)));
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
  const faceDuration = 0.32;

  return (
    <DragDropProvider
      onDragStart={() => {
        setHoldSize({ width: shown.width, height: shown.height });
      }}
      onDragEnd={(event) => {
        setHoldSize(null);
        if (event.canceled) {
          return;
        }
        const { source, target } = event.operation;
        if (!source) {
          return;
        }
        const sourceId = String(source.id);
        const id = dragActivityId(sourceId);
        const home = canonicalItems(committed, catalog);
        if (sourceId.startsWith("tray:")) {
          const overHome =
            target &&
            (String(target.id) === HOME_GROUP ||
              (isSortable(target) && target.group === HOME_GROUP));
          if (!overHome) {
            return;
          }
          const next = home.filter((item) => !sameActivity(item, id));
          const index = isSortable(target)
            ? Math.max(0, Math.min(target.index, next.length))
            : next.length;
          next.splice(index, 0, id);
          updateLayout({ items: next });
          return;
        }
        if (!isSortable(source)) {
          return;
        }
        if (target && String(target.id) === TRAY_GROUP) {
          updateLayout({
            items: home.filter((item) => !sameActivity(item, id)),
          });
          return;
        }
        const next = home.filter((item) => !sameActivity(item, id));
        if (source.group === HOME_GROUP) {
          next.splice(Math.max(0, Math.min(source.index, next.length)), 0, id);
        }
        updateLayout({ items: next });
      }}
    >
      <div className={`island-stage${customizing ? " is-editing" : ""}`}>
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
            className={`island-shell${customizing ? " is-editing" : ""}`}
            style={shellStyle}
            onClick={() => {
              if (!expanded) {
                open();
              }
            }}
          >
            <div className="island-layers">
              <motion.div
                className="island-layer island-layer-compact"
                initial={false}
                animate={{
                  opacity: expanded ? 0 : 1,
                }}
                transition={{
                  opacity: expanded ? layerMotion.expand : layerMotion.collapse,
                }}
                style={{ pointerEvents: expanded ? "none" : "auto" }}
              >
                <div
                  className={`island-body is-fit ${presence === "expanded" ? "peek" : presence}`}
                >
                  <div ref={compactFitRef} className="island-fit">
                    <FaceSwap
                      id={faceId}
                      reduced={reduced}
                      duration={faceDuration}
                    >
                      <IslandFace
                        presence={presence === "expanded" ? "peek" : presence}
                        composition={composition}
                        activities={activities}
                        idleProvider={settings.idleProvider}
                        clock={clock}
                        layout={layout}
                        committed={layout}
                        catalog={catalog}
                        customizing={false}
                        interactive={false}
                        reduced={reduced}
                        onLayout={updateLayout}
                        onAction={(pluginId, actionId, payload) => {
                          void engine.activities.action(
                            pluginId,
                            actionId,
                            payload,
                          );
                        }}
                        onInteract={markInteraction}
                      />
                    </FaceSwap>
                  </div>
                </div>
              </motion.div>
              <motion.div
                className={`island-layer island-layer-expanded${customizing ? " is-editing" : ""}`}
                initial={false}
                animate={{
                  opacity: expanded ? 1 : 0,
                  filter: expanded ? "blur(0px)" : "blur(5px)",
                }}
                transition={{
                  opacity: expanded ? layerMotion.expand : layerMotion.collapse,
                  filter: expanded ? layerMotion.expand : layerMotion.collapse,
                }}
                style={{ pointerEvents: expanded ? "auto" : "none" }}
              >
                <div className="island-body expanded">
                  <div ref={expandedFitRef} className="island-fit">
                    <IslandFace
                      presence="expanded"
                      composition={composition}
                      activities={activities}
                      idleProvider={settings.idleProvider}
                      clock={clock}
                      layout={layout}
                      committed={committed}
                      catalog={catalog}
                      customizing={customizing}
                      interactive
                      onLayout={updateLayout}
                      onAction={(pluginId, actionId, payload) => {
                        void engine.activities.action(
                          pluginId,
                          actionId,
                          payload,
                        );
                      }}
                      onInteract={markInteraction}
                    />
                  </div>
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
          ref={trayRef}
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
            layout={committed}
            committed={committed}
            onPlace={(activityId) =>
              updateLayout(placeActivity(committed, activityId))
            }
          />
        </motion.div>
      </div>
    </DragDropProvider>
  );
}

function IslandFace({
  presence,
  composition,
  activities,
  idleProvider,
  clock,
  layout,
  committed,
  catalog,
  customizing,
  interactive = true,
  reduced = false,
  onLayout,
  onAction,
  onInteract,
}: {
  presence: Presence;
  composition: ReturnType<typeof useIsland>["composition"];
  activities: ActivitySnapshot[];
  idleProvider: IdleProvider;
  clock: ClockSettings;
  layout: HomeLayout;
  committed: HomeLayout;
  catalog: ReturnType<typeof useIsland>["catalog"];
  customizing: boolean;
  interactive?: boolean;
  reduced?: boolean;
  onLayout: (layout: HomeLayout) => void;
  onAction: (pluginId: string, actionId: string, payload?: string) => void;
  onInteract: (activityId: string) => void;
}) {
  if (presence === "expanded") {
    return (
      <div className="home-wrap">
        <HomeStrip
          layout={layout}
          committed={committed}
          catalog={catalog}
          customizing={customizing}
          interactive={interactive}
          onAction={onAction}
          onRemove={(activityId) =>
            onLayout(removeActivity(committed, activityId))
          }
        />
      </div>
    );
  }

  const plan = composition.composition;
  if (plan.faceMode === "takeover" && plan.transient) {
    const snapshot =
      activities.find(
        (activity) => activity.activityId === plan.transient?.activityId,
      ) ?? null;
    return (
      <div className="composition is-takeover">
        <ComposedTransient
          transient={plan.transient}
          snapshot={snapshot}
          onAction={onAction}
          onInteract={onInteract}
        />
      </div>
    );
  }
  if (plan.faceMode === "resident") {
    const snapshotById = new Map(
      activities.map((activity) => [activity.activityId, activity]),
    );
    return (
      <div className="composition is-resident">
        <ComposedSegments
          segments={plan.segments}
          hidden={plan.hidden}
          snapshots={snapshotById}
          onAction={onAction}
          onInteract={onInteract}
        />
      </div>
    );
  }
  return (
    <IdleFace
      presence={presence}
      provider={idleProvider}
      clock={clock}
      activities={activities}
      catalog={catalog}
      reduced={reduced}
    />
  );
}

function ComposedSegments({
  segments,
  hidden,
  snapshots,
  onAction,
  onInteract,
}: {
  segments: NonNullable<
    ReturnType<typeof useIsland>["composition"]
  >["composition"]["segments"];
  hidden: number;
  snapshots: Map<string, ActivitySnapshot | null>;
  onAction: (pluginId: string, actionId: string, payload?: string) => void;
  onInteract: (activityId: string) => void;
}) {
  return (
    <div className="composition-segments">
      <AnimatePresence initial={false}>
        {segments.map((segment) => {
          if (segment.overflow) {
            return (
              <motion.span
                key={segment.id}
                className="composition-overflow"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                style={{ flex: "0 0 auto" }}
              >
                +{hidden}
              </motion.span>
            );
          }
          const snapshot = snapshots.get(segment.id) ?? null;
          if (!snapshot) {
            return null;
          }
          const node = variantNode(snapshot, segment.density);
          if (!node) {
            return null;
          }
          return (
            <motion.div
              key={segment.id}
              className="composition-segment"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              style={{ flex: "0 0 auto" }}
              onPointerDown={() => onInteract(segment.activityId)}
            >
              <ActivityView
                node={node}
                snapshot={snapshot}
                onAction={(actionId, payload) =>
                  onAction(snapshot.pluginId, actionId, payload)
                }
              />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

function ComposedTransient({
  transient,
  snapshot,
  onAction,
  onInteract,
}: {
  transient: NonNullable<
    NonNullable<
      ReturnType<typeof useIsland>["composition"]
    >["composition"]["transient"]
  >;
  snapshot: ActivitySnapshot | null;
  onAction: (pluginId: string, actionId: string, payload?: string) => void;
  onInteract: (activityId: string) => void;
}) {
  if (!snapshot) {
    return null;
  }
  const node = variantNode(snapshot, transient.density);
  if (!node) {
    return null;
  }
  return (
    <div
      className="composition-transient"
      onPointerDown={() => onInteract(transient.activityId)}
    >
      <ActivityView
        node={node}
        snapshot={snapshot}
        onAction={(actionId, payload) =>
          onAction(snapshot.pluginId, actionId, payload)
        }
      />
    </div>
  );
}
