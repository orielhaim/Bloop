import { ActivityView, previewNode } from "@/activities/renderer";
import { TimeReadout } from "@/components/clock/time-readout";
import { type CatalogItem, catalogItem } from "@/lib/engine/layout";
import type {
  ActivitySnapshot,
  ClockSettings,
  IdleProvider,
  Presence,
} from "@/lib/engine/types";
import { cn } from "@/lib/utils";
import { formatIdleDate, useClock, wallParts } from "./clock";

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

export function idleFaceKey(
  provider: IdleProvider,
  activities: ActivitySnapshot[],
) {
  if (provider.kind === "plugin") {
    return `idle:plugin:${provider.id}`;
  }
  if (provider.kind === "media") {
    const snapshot = activities.find(
      (activity) => activity.variants.length > 0,
    );
    return snapshot ? `idle:media:${snapshot.activityId}` : "idle:media";
  }
  return `idle:${provider.kind}`;
}

export function IdleFace({
  presence,
  provider,
  clock,
  activities,
  catalog,
  reduced: _reduced = false,
}: {
  presence: Presence;
  provider: IdleProvider;
  clock: ClockSettings;
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
        : (activities.find((activity) => activity.variants.length > 0) ?? null);
    const node = previewNode(snapshot);
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
  return <ClockIdle peek={presence === "peek"} clock={clock} />;
}

function ClockIdle({ peek, clock }: { peek: boolean; clock: ClockSettings }) {
  const now = useClock();
  const parts = wallParts(now);
  return (
    <div className={cn("face-idle is-clock", peek && "is-peek")}>
      <TimeReadout
        className="idle-time"
        hours={parts.hours}
        minutes={parts.minutes}
        seconds={parts.seconds}
        showHours
        showSeconds={clock.showSeconds}
        padHours
        motion={clock.motion}
      />
      <div className="idle-date-slot">
        <div className="idle-date-clip">
          <span className="idle-date">{formatIdleDate(now)}</span>
        </div>
      </div>
    </div>
  );
}
