import { motion } from "motion/react";
import { ActivityView, nodeForPresence } from "@/activities/renderer";
import { type CatalogItem, catalogItem } from "@/lib/engine/layout";
import type {
  ActivitySnapshot,
  IdleProvider,
  Presence,
} from "@/lib/engine/types";
import { cn } from "@/lib/utils";
import { formatIdleDate, formatIdleTime, useClock } from "./clock";

const dateEase = [0.22, 1, 0.36, 1] as const;

export function occupiesIslandFace(
  activity: ActivitySnapshot | null | undefined,
) {
  return Boolean(activity?.peek) || activity?.mode === "presentation";
}

export function activitiesFromEnabledPlugins(
  activities: ActivitySnapshot[],
  plugins: { id: string; enabled: boolean }[],
) {
  if (plugins.length === 0) {
    return activities;
  }
  const enabled = new Set(
    plugins.filter((plugin) => plugin.enabled).map((plugin) => plugin.id),
  );
  return activities.filter((activity) => enabled.has(activity.pluginId));
}

export function retainOccupant(
  previous: ActivitySnapshot | null,
  current: ActivitySnapshot | null,
  activities: ActivitySnapshot[],
): ActivitySnapshot | null {
  if (occupiesIslandFace(current) && current) {
    return current;
  }
  if (!previous || !occupiesIslandFace(previous)) {
    return occupiesIslandFace(current) ? current : null;
  }
  const listed = activities.find(
    (activity) => activity.activityId === previous.activityId,
  );
  if (!listed || !occupiesIslandFace(listed)) {
    return null;
  }
  return {
    ...previous,
    ...listed,
    peek: listed.peek ?? previous.peek,
    presentation: listed.presentation ?? previous.presentation,
    mode: listed.mode === "presentation" ? listed.mode : "peek",
  };
}

export function idleFaceKey(
  provider: IdleProvider,
  activities: ActivitySnapshot[],
) {
  if (provider.kind === "plugin") {
    return `idle:plugin:${provider.id}`;
  }
  if (provider.kind === "media") {
    const snapshot = activities.find(
      (activity) => activity.peek || activity.compact,
    );
    return snapshot ? `idle:media:${snapshot.activityId}` : "idle:media";
  }
  return `idle:${provider.kind}`;
}

export function IdleFace({
  presence,
  provider,
  activities,
  catalog,
  reduced = false,
}: {
  presence: Presence;
  provider: IdleProvider;
  activities: ActivitySnapshot[];
  catalog: CatalogItem[];
  reduced?: boolean;
}) {
  if (provider.kind === "none") {
    return <div className="face-idle is-empty" />;
  }
  if (provider.kind === "media" || provider.kind === "plugin") {
    const snapshot =
      provider.kind === "plugin"
        ? (activities.find((activity) => activity.pluginId === provider.id) ??
          null)
        : (activities.find((activity) => activity.peek || activity.compact) ??
          null);
    const node = nodeForPresence(
      snapshot,
      presence === "peek" ? "peek" : "resting",
    );
    if (snapshot && node) {
      return (
        <div
          className={cn("face-live", presence === "peek" ? "peek" : "resting")}
        >
          <ActivityView
            node={node}
            snapshot={snapshot}
            onAction={() => undefined}
          />
        </div>
      );
    }
    if (provider.kind === "plugin") {
      const item = catalogItem(catalog, provider.id);
      return (
        <div className="face-idle">
          <span className="idle-kicker">{item?.name ?? provider.id}</span>
        </div>
      );
    }
    return <div className="face-idle is-empty" />;
  }
  return <ClockIdle peek={presence === "peek"} reduced={reduced} />;
}

function ClockIdle({ peek, reduced }: { peek: boolean; reduced: boolean }) {
  const now = useClock();
  const transition = reduced
    ? { duration: 0 }
    : {
        duration: peek ? 0.38 : 0.2,
        ease: dateEase,
      };
  return (
    <div className={cn("face-idle is-clock", peek && "is-peek")}>
      <span className="idle-time">{formatIdleTime(now)}</span>
      <motion.div
        className="idle-date-slot"
        initial={false}
        animate={{
          gridTemplateRows: peek ? "1fr" : "0fr",
          opacity: peek ? 1 : 0,
        }}
        transition={transition}
      >
        <div className="idle-date-clip">
          <span className="idle-date">{formatIdleDate(now)}</span>
        </div>
      </motion.div>
    </div>
  );
}
