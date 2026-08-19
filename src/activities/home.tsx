import { CollisionPriority } from "@dnd-kit/abstract";
import { useDraggable, useDroppable } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { Pause, Play, Plus, RotateCcw, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Component, type ReactNode, type Ref } from "react";
import { FiX } from "react-icons/fi";
import { ActivityView, findUiNode, previewNode } from "@/activities/renderer";
import { UiCountdown } from "@/components/timer/digits";
import { WheelDurationPicker } from "@/components/timer/wheel-duration";
import {
  type CatalogItem,
  catalogItem,
  placedItems,
  sameActivity,
  unplacedCatalog,
} from "@/lib/engine/layout";
import type { ActivitySnapshot, HomeLayout, UiNode } from "@/lib/engine/types";
import { cn } from "@/lib/utils";

const pop = {
  duration: 0.22,
  ease: [0.22, 1, 0.36, 1] as const,
};

export const HOME_GROUP = "home";
export const TRAY_GROUP = "tray";
export const ACTIVITY_TYPE = "activity";

export function dragActivityId(sourceId: string) {
  return sourceId.startsWith("tray:") ? sourceId.slice(5) : sourceId;
}

class CardGuard extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.error("home card render failed", error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function isTimerItem(item: CatalogItem) {
  return item.pluginId.includes("timer") || item.id.includes("timer");
}

export function placeActivity(
  layout: HomeLayout,
  activityId: string,
): HomeLayout {
  const items = placedItems(layout);
  if (items.some((id) => sameActivity(id, activityId))) {
    return layout;
  }
  return { items: [...items, activityId] };
}

export function removeActivity(
  layout: HomeLayout,
  activityId: string,
): HomeLayout {
  return {
    items: placedItems(layout).filter((id) => !sameActivity(id, activityId)),
  };
}

function cardNode(item: CatalogItem): {
  activity: ActivitySnapshot | null;
  node: UiNode | null;
} {
  const activity = item.snapshot;
  const node = activity?.expanded ?? previewNode(activity);
  return { activity, node };
}

export function HomeStrip({
  layout,
  committed,
  catalog,
  customizing,
  interactive = true,
  onAction,
  onRemove,
}: {
  layout: HomeLayout;
  committed: HomeLayout;
  catalog: CatalogItem[];
  customizing: boolean;
  interactive?: boolean;
  onAction: (pluginId: string, actionId: string, payload?: string) => void;
  onRemove: (activityId: string) => void;
}) {
  const itemIds = placedItems(layout);
  const placed = placedItems(committed);
  const sortable = interactive && customizing;
  const { ref } = useDroppable({
    id: interactive ? HOME_GROUP : "home-measure",
    type: "column",
    accept: ACTIVITY_TYPE,
    collisionPriority: CollisionPriority.Low,
    disabled: !sortable,
  });
  return (
    <div
      ref={ref}
      className="home"
      data-home-live={interactive ? "" : undefined}
    >
      <section className="home-strip">
        {itemIds.length === 0 ? (
          <p className="home-empty">No activities yet.</p>
        ) : null}
        <AnimatePresence initial={false}>
          {itemIds.map((id, index) => {
            const item = catalogItem(catalog, id);
            if (!item) {
              return null;
            }
            const ghost = !placed.some((placedId) =>
              sameActivity(placedId, item.id),
            );
            return sortable ? (
              <HomeCard
                key={item.id}
                id={item.id}
                index={index}
                item={item}
                customizing={customizing}
                ghost={ghost}
                onAction={onAction}
                onRemove={() => onRemove(item.id)}
              />
            ) : (
              <HomeCardView
                key={item.id}
                id={item.id}
                item={item}
                customizing={customizing}
                ghost={ghost}
                dragging={false}
                onAction={onAction}
                onRemove={() => onRemove(item.id)}
              />
            );
          })}
        </AnimatePresence>
      </section>
    </div>
  );
}

function HomeCard({
  id,
  index,
  item,
  customizing,
  ghost,
  onAction,
  onRemove,
}: {
  id: string;
  index: number;
  item: CatalogItem;
  customizing: boolean;
  ghost: boolean;
  onAction: (pluginId: string, actionId: string, payload?: string) => void;
  onRemove: () => void;
}) {
  const { ref, isDragging } = useSortable({
    id,
    index,
    type: ACTIVITY_TYPE,
    accept: ACTIVITY_TYPE,
    group: HOME_GROUP,
  });
  return (
    <HomeCardView
      ref={ref}
      id={id}
      item={item}
      customizing={customizing}
      ghost={ghost}
      dragging={isDragging}
      onAction={onAction}
      onRemove={onRemove}
    />
  );
}

function HomeCardView({
  ref,
  id,
  item,
  customizing,
  ghost,
  dragging,
  onAction,
  onRemove,
}: {
  ref?: Ref<HTMLElement>;
  id: string;
  item: CatalogItem;
  customizing: boolean;
  ghost: boolean;
  dragging: boolean;
  onAction: (pluginId: string, actionId: string, payload?: string) => void;
  onRemove: () => void;
}) {
  const { activity, node } = cardNode(item);
  return (
    <article
      ref={ref}
      data-home-card={id}
      data-plugin={item.pluginId}
      className={cn(
        "home-card",
        customizing && "is-editing",
        dragging && "is-dragging",
        ghost && "is-hovering",
      )}
    >
      <motion.div
        className="home-card-pop"
        initial={ghost ? { opacity: 0, scale: 0.86 } : false}
        animate={{ opacity: 1, scale: 1 }}
        exit={ghost ? { opacity: 0, scale: 0.86 } : undefined}
        transition={ghost ? pop : { duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      >
        {customizing && !ghost ? (
          <button
            type="button"
            className="home-card-remove"
            aria-label={`Remove ${item.name}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
          >
            <FiX size={12} />
          </button>
        ) : null}
        <div className={cn("home-card-preview", customizing && "is-mock")}>
          {isTimerItem(item) ? (
            <TimerHome
              item={item}
              customizing={customizing}
              onAction={onAction}
            />
          ) : activity && node ? (
            <CardGuard fallback={<p className="face-kicker">{item.name}</p>}>
              <ActivityView
                node={node}
                snapshot={activity}
                onAction={
                  customizing
                    ? () => undefined
                    : (actionId, payload) =>
                        onAction(activity.pluginId, actionId, payload)
                }
              />
            </CardGuard>
          ) : (
            <p className="face-kicker">{item.name}</p>
          )}
        </div>
      </motion.div>
    </article>
  );
}

export function ActivityTray({
  catalog,
  layout,
  committed,
  onPlace,
}: {
  catalog: CatalogItem[];
  layout: HomeLayout;
  committed: HomeLayout;
  draggingId?: string | null;
  onPlace: (activityId: string) => void;
}) {
  const { ref } = useDroppable({
    id: TRAY_GROUP,
    type: "column",
    accept: ACTIVITY_TYPE,
    collisionPriority: CollisionPriority.Low,
  });
  const available = unplacedCatalog(catalog, layout);
  const placed = placedItems(committed);
  return (
    <div ref={ref} className="activity-tray">
      {available.length === 0 ? (
        <p className="home-empty">No activities in the tray.</p>
      ) : null}
      <AnimatePresence initial={false}>
        {available.map((item, index) => (
          <TrayChip
            key={item.id}
            item={item}
            index={index}
            ghost={placed.some((id) => sameActivity(id, item.id))}
            onPlace={() => onPlace(item.id)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

function TimerHome({
  item,
  customizing,
  onAction,
}: {
  item: CatalogItem;
  customizing: boolean;
  onAction: (pluginId: string, actionId: string, payload?: string) => void;
}) {
  const snapshot = item.snapshot;
  const root = snapshot?.expanded ?? snapshot?.preview ?? null;
  const ruler = findUiNode(root, "ruler");
  const countdown = findUiNode(root, "countdown");
  const emit = (actionId: string, payload?: string) => {
    if (!customizing) {
      onAction(item.pluginId, actionId, payload);
    }
  };

  if (countdown && countdown.kind === "countdown") {
    const running = countdown.running !== false;
    return (
      <div className="timer-live">
        <UiCountdown
          deadlineMs={countdown.deadlineMs}
          running={running}
          pausedRemainingMs={countdown.pausedRemainingMs ?? null}
          totalMs={countdown.totalMs ?? null}
          onAction={emit}
        />
        <div className="timer-live-actions">
          <button
            type="button"
            className="ui-icon-button"
            aria-label={running ? "Pause" : "Resume"}
            onClick={(event) => {
              event.stopPropagation();
              emit(running ? "pause" : "resume");
            }}
          >
            {running ? (
              <Pause size={15} strokeWidth={1.85} />
            ) : (
              <Play size={15} strokeWidth={1.85} />
            )}
          </button>
          <button
            type="button"
            className="ui-icon-button"
            aria-label="Add minute"
            onClick={(event) => {
              event.stopPropagation();
              emit("addMinute");
            }}
          >
            <Plus size={15} strokeWidth={1.85} />
          </button>
          <button
            type="button"
            className="ui-icon-button"
            aria-label="Cancel"
            onClick={(event) => {
              event.stopPropagation();
              emit("cancel");
            }}
          >
            <X size={15} strokeWidth={1.85} />
          </button>
        </div>
      </div>
    );
  }

  const valueMs = ruler && ruler.kind === "ruler" ? ruler.valueMs : 5 * 60_000;
  const minMs = ruler && ruler.kind === "ruler" ? ruler.minMs : 5_000;
  const maxMs =
    ruler && ruler.kind === "ruler" ? ruler.maxMs : 3 * 60 * 60 * 1000;

  return (
    <div className="ui-row center" style={{ gap: 12 }}>
      <WheelDurationPicker
        valueMs={valueMs ?? 5 * 60_000}
        minMs={minMs ?? 5_000}
        maxMs={maxMs ?? 3 * 60 * 60 * 1000}
        onCommit={(value) => emit("setValue", String(value))}
      />
      <div className="ui-column" style={{ gap: 8 }}>
        <button
          type="button"
          className="ui-icon-button"
          aria-label="Start"
          onClick={(event) => {
            event.stopPropagation();
            emit("start");
          }}
        >
          <Play size={16} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className="ui-icon-button"
          aria-label="Reset"
          onClick={(event) => {
            event.stopPropagation();
            emit("reset");
          }}
        >
          <RotateCcw size={16} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}

export function ActivityIcon({
  name,
  src,
}: {
  name: string;
  src?: string | null;
}) {
  if (src) {
    return <img className="plugin-icon" src={src} alt="" draggable={false} />;
  }
  return <span className="ui-badge">{name.slice(0, 1).toUpperCase()}</span>;
}

function TrayChip({
  item,
  ghost,
  onPlace,
}: {
  item: CatalogItem;
  index: number;
  ghost: boolean;
  onPlace: () => void;
}) {
  const { ref, isDragging } = useDraggable({
    id: `tray:${item.id}`,
    type: ACTIVITY_TYPE,
    disabled: ghost,
  });
  return (
    <motion.button
      ref={ref}
      type="button"
      initial={ghost ? { opacity: 0, scale: 0.86 } : false}
      animate={{ opacity: isDragging ? 0.45 : 1, scale: 1 }}
      exit={ghost ? { opacity: 0, scale: 0.86 } : { opacity: 0 }}
      transition={ghost ? pop : { duration: 0.12 }}
      className={cn("activity-chip", isDragging && "is-dragging")}
      aria-label={item.name}
      onClick={(event) => {
        event.stopPropagation();
        onPlace();
      }}
    >
      <ActivityIcon name={item.name} src={item.iconUrl} />
    </motion.button>
  );
}
