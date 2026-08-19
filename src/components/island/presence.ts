import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { semanticsFromSnapshot } from "@/composition/adapter";
import { computeBudget } from "@/composition/budget";
import { type SolveOutput, solve } from "@/composition/engine";
import { type CompositionMemory, emptyMemory } from "@/composition/types";
import { activitiesFromEnabledPlugins } from "@/idle/face";
import { engine } from "@/lib/engine";
import {
  activityCatalog,
  normalizeLayout,
  pruneUnknownActivities,
} from "@/lib/engine/layout";
import {
  type AppSettings,
  fallbackSettings,
  fallbackTheme,
  type HomeLayout,
  type IslandState,
  type PluginRecord,
  type Presence,
  type ThemeDocument,
} from "@/lib/engine/types";
import { islandWindow } from "./metrics";

function resolvePresence(
  state: IslandState | null,
  composition: SolveOutput,
  stickyHover: boolean,
  opened: boolean,
  idleKind: AppSettings["idleProvider"]["kind"],
): Presence {
  if (opened || state?.sticky || state?.presence === "expanded") {
    return "expanded";
  }
  if (composition.composition.faceMode === "takeover") {
    return "presentation";
  }
  if (composition.composition.faceMode === "resident") {
    return "peek";
  }
  return stickyHover && idleKind !== "none" ? "peek" : "resting";
}

export function useIsland() {
  const [state, setState] = useState<IslandState | null>(null);
  const [settings, setSettings] = useState<AppSettings>(fallbackSettings);
  const [theme, setTheme] = useState<ThemeDocument>(fallbackTheme);
  const [hovering, setHovering] = useState(false);
  const [stickyHover, setStickyHover] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [opened, setOpened] = useState(false);
  const [plugins, setPlugins] = useState<PluginRecord[]>([]);
  const [tick, setTick] = useState(0);

  const refreshGen = useRef(0);
  // Composition continuity memory persists across solves.
  const memoryRef = useRef<CompositionMemory>(emptyMemory());
  // Interaction recency: activityId -> wall time of last user interaction.
  const interactionRef = useRef<Record<string, number>>({});

  const refresh = useCallback(async () => {
    const gen = ++refreshGen.current;
    const [nextState, nextSettings, nextTheme, nextPlugins] = await Promise.all(
      [
        engine.activities.state(),
        engine.settings.get(),
        engine.themes.current(),
        engine.plugins.list(),
      ],
    );
    if (gen !== refreshGen.current) {
      return;
    }
    setPlugins(nextPlugins);
    if (nextState) {
      setState(nextState);
      const catalog = activityCatalog(nextPlugins, nextState.activities);
      const synced = pruneUnknownActivities(
        normalizeLayout(nextSettings.layout),
        catalog,
      );
      setSettings({ ...nextSettings, layout: synced.layout });
      if (synced.dirty) {
        void engine.settings.setLayout(synced.layout);
      }
    } else {
      setSettings({
        ...nextSettings,
        layout: normalizeLayout(nextSettings.layout),
      });
    }
    setTheme(nextTheme);
  }, []);

  useEffect(() => {
    void refresh();
    let frame = 0;
    const stop = engine.events.subscribe(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        void refresh();
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      void stop.then((unlisten) => unlisten());
    };
  }, [refresh]);

  useEffect(() => {
    const pointer = listen<boolean>("island-pointer", (event) => {
      setHovering(event.payload);
    });
    const dismiss = listen("island-dismiss", () => {
      setCustomizing(false);
      setStickyHover(false);
      setOpened(false);
      void engine.activities.collapse();
    });
    return () => {
      void pointer.then((stop) => stop());
      void dismiss.then((stop) => stop());
    };
  }, []);

  useEffect(() => {
    if (state?.sticky || opened) {
      return;
    }
    if (hovering) {
      const timer = window.setTimeout(
        () => setStickyHover(true),
        settings.hoverOpenMs,
      );
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(
      () => setStickyHover(false),
      settings.hoverCloseMs,
    );
    return () => window.clearTimeout(timer);
  }, [
    hovering,
    opened,
    settings.hoverCloseMs,
    settings.hoverOpenMs,
    state?.sticky,
  ]);

  const liveActivities = useMemo(
    () => activitiesFromEnabledPlugins(state?.activities ?? [], plugins),
    [plugins, state?.activities],
  );

  // Re-solve composition over time only when an Activity has a deadline whose
  // urgency evolves (a running countdown). Otherwise the solver is only run on
  // real state changes — the system stays effectively idle.
  const hasDeadline = liveActivities.some(
    (activity) =>
      activity.deadlineMs != null &&
      activity.attention?.urgencyWindowMs != null,
  );
  useEffect(() => {
    if (!hasDeadline) {
      return;
    }
    const timer = window.setInterval(() => {
      // Force the composition memo to recompute with a fresh `now`.
      setTick((value) => value + 1);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [hasDeadline]);

  /** Mark an Activity as recently interacted; temporarily boosts its value. */
  const markInteraction = useCallback(
    (activityId: string) => {
      interactionRef.current[activityId] = Date.now();
      void refresh();
    },
    [refresh],
  );

  const composition = useMemo<SolveOutput>(() => {
    const budget = computeBudget({
      windowWidth: islandWindow.width,
      dpr: window.devicePixelRatio || 1,
      preference: settings.composition ?? "auto",
    });
    const semantics = liveActivities.map(semanticsFromSnapshot);
    const now = tick >= 0 ? Date.now() : Date.now();
    const result = solve({
      activities: semantics,
      budget,
      now,
      memory: memoryRef.current,
    });
    memoryRef.current = result.memory;
    return result;
  }, [liveActivities, settings.composition, tick]);

  const presence = useMemo(
    () =>
      resolvePresence(
        state,
        composition,
        stickyHover,
        opened,
        settings.idleProvider.kind,
      ),
    [composition, opened, settings.idleProvider.kind, state, stickyHover],
  );

  const open = useCallback(() => {
    setOpened(true);
    void engine.activities.open();
  }, []);

  const updateLayout = useCallback(
    (layout: HomeLayout) => {
      void engine.settings.setLayout(layout).then(() => refresh());
    },
    [refresh],
  );

  const catalog = useMemo(
    () => activityCatalog(plugins, liveActivities),
    [liveActivities, plugins],
  );

  return {
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
    refresh,
    markInteraction,
  };
}
