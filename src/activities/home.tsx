import { CollisionPriority } from "@dnd-kit/abstract";
import { pointerIntersection } from "@dnd-kit/collision";
import { useDraggable, useDroppable } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { AnimatePresence, motion } from "motion/react";
import { FiX } from "react-icons/fi";
import { ActivityView } from "@/activities/renderer";
import {
  type CatalogItem,
  catalogItem,
  placedItems,
  sameActivity,
  unplacedCatalog,
} from "@/lib/engine/layout";
import type { HomeLayout } from "@/lib/engine/types";
import { cn } from "@/lib/utils";

const pop = {
  duration: 0.22,
  ease: [0.22, 1, 0.36, 1] as const,
};

export function isIslandDropTarget(targetId: unknown): boolean {
  const target = String(targetId ?? "");
  return Boolean(target) && target !== "tray" && !target.startsWith("tray:");
}

export function dropIndex(
  layout: HomeLayout,
  targetId: unknown,
  fallback: number,
): number {
  const target = String(targetId ?? "");
  if (target === "home" || target === "tray" || !target) {
    return placedItems(layout).length;
  }
  const index = placedItems(layout).findIndex((id) => sameActivity(id, target));
  return index >= 0 ? index : fallback;
}

export function applyHomeDrag(
  layout: HomeLayout,
  sourceId: string,
  sourceIndex: number,
  targetId: unknown,
): HomeLayout | null {
  const items = [...placedItems(layout)];
  const target = String(targetId ?? "");

  if (sourceId.startsWith("tray:")) {
    const activityId = sourceId.slice(5);
    const next = items.filter((id) => !sameActivity(id, activityId));
    if (!isIslandDropTarget(targetId)) {
      return { items: next };
    }
    if (!next.some((id) => sameActivity(id, activityId))) {
      next.splice(
        Math.min(Math.max(sourceIndex, 0), next.length),
        0,
        activityId,
      );
    }
    return { items: next };
  }

  const from = items.findIndex((id) => sameActivity(id, sourceId));
  if (from < 0) {
    return null;
  }
  const [moved] = items.splice(from, 1);
  if (!moved) {
    return null;
  }
  if (target === "tray") {
    return { items };
  }
  if (!isIslandDropTarget(targetId)) {
    return layout;
  }
  items.splice(Math.min(sourceIndex, items.length), 0, moved);
  return { items };
}

export function hoverHomeLayout(
  layout: HomeLayout,
  sourceId: string,
  sourceIndex: number,
  targetId: unknown,
): HomeLayout | null {
  if (sourceId.startsWith("tray:")) {
    if (!isIslandDropTarget(targetId)) {
      return null;
    }
    return applyHomeDrag(
      layout,
      sourceId,
      dropIndex(layout, targetId, sourceIndex),
      targetId,
    );
  }
  if (String(targetId ?? "") === "tray") {
    return applyHomeDrag(layout, sourceId, sourceIndex, "tray");
  }
  return null;
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
  const { ref } = useDroppable({
    id: interactive ? "home" : "home-measure",
    disabled: !interactive,
    collisionDetector: pointerIntersection,
    collisionPriority: CollisionPriority.Normal,
  });
  return (
    <div ref={ref} className="home">
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
            return (
              <HomeCard
                key={item.id}
                id={item.id}
                index={index}
                item={item}
                customizing={customizing}
                ghost={ghost}
                interactive={interactive}
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
  interactive,
  onAction,
  onRemove,
}: {
  id: string;
  index: number;
  item: CatalogItem;
  customizing: boolean;
  ghost: boolean;
  interactive: boolean;
  onAction: (pluginId: string, actionId: string, payload?: string) => void;
  onRemove: () => void;
}) {
  const { ref, isDragging } = useSortable({
    id,
    index,
    group: "home",
    disabled: !interactive || !customizing || ghost,
    collisionDetector: pointerIntersection,
    plugins: [],
  });
  const activity = item.snapshot;
  const node = customizing
    ? (activity?.preview ??
      activity?.expanded ??
      activity?.peek ??
      activity?.compact)
    : (activity?.expanded ?? activity?.peek ?? activity?.compact);
  return (
    <article
      ref={ref}
      className={cn(
        "home-card",
        customizing && "is-editing",
        isDragging && "is-dragging",
        ghost && "is-hovering",
      )}
    >
      <motion.div
        className="home-card-pop"
        initial={ghost ? { opacity: 0, scale: 0.86 } : false}
        animate={{ opacity: 1, scale: 1 }}
        exit={ghost ? { opacity: 0, scale: 0.86 } : undefined}
        transition={ghost ? pop : { duration: 0 }}
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
        {activity && node ? (
          <div className={cn("home-card-preview", customizing && "is-mock")}>
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
          </div>
        ) : (
          <p className="face-kicker">{item.name}</p>
        )}
      </motion.div>
    </article>
  );
}

export function ActivityTray({
  catalog,
  layout,
  committed,
  draggingId,
  onPlace,
}: {
  catalog: CatalogItem[];
  layout: HomeLayout;
  committed: HomeLayout;
  draggingId?: string | null;
  onPlace: (activityId: string) => void;
}) {
  const { ref } = useDroppable({
    id: "tray",
    collisionDetector: pointerIntersection,
    collisionPriority: CollisionPriority.Normal,
  });
  const available = unplacedCatalog(catalog, layout);
  const placed = placedItems(committed);
  return (
    <div ref={ref} className="activity-tray">
      {available.length === 0 ? (
        <p className="home-empty">No activities in the tray.</p>
      ) : null}
      <AnimatePresence initial={false}>
        {available.map((item) => (
          <TrayChip
            key={item.pluginId}
            item={item}
            ghost={placed.some((id) => sameActivity(id, item.id))}
            dragging={Boolean(draggingId && sameActivity(draggingId, item.id))}
            onPlace={() => onPlace(item.id)}
          />
        ))}
      </AnimatePresence>
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
  dragging,
  onPlace,
}: {
  item: CatalogItem;
  ghost: boolean;
  dragging: boolean;
  onPlace: () => void;
}) {
  const { ref, isDragging } = useDraggable({ id: `tray:${item.id}` });
  return (
    <motion.button
      ref={ref}
      type="button"
      initial={ghost ? { opacity: 0, scale: 0.86 } : false}
      animate={{ opacity: dragging || isDragging ? 0.45 : 1, scale: 1 }}
      exit={ghost ? { opacity: 0, scale: 0.86 } : { opacity: 0 }}
      transition={ghost ? pop : { duration: 0.12 }}
      className={cn("activity-chip", (isDragging || dragging) && "is-dragging")}
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
