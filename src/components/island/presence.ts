import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  activitiesFromEnabledPlugins,
  occupiesIslandFace,
  retainOccupant,
} from "@/idle/face";
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

function resolvePresence(
  state: IslandState | null,
  occupant: IslandState["activity"],
  stickyHover: boolean,
  opened: boolean,
  idleKind: AppSettings["idleProvider"]["kind"],
): Presence {
  if (opened || state?.sticky || state?.presence === "expanded") {
    return "expanded";
  }
  if (!state) {
    return stickyHover && idleKind !== "none" ? "peek" : "resting";
  }
  if (state.presence === "presentation" || occupant?.mode === "presentation") {
    return "presentation";
  }
  if (occupiesIslandFace(occupant)) {
    return "peek";
  }
  if (stickyHover && idleKind !== "none") {
    return "peek";
  }
  return "resting";
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

  const occupantRef = useRef<IslandState["activity"]>(null);
  const refreshGen = useRef(0);

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
  const liveCurrent = useMemo(() => {
    const current = state?.activity ?? null;
    if (!current) {
      return null;
    }
    return liveActivities.some(
      (activity) => activity.activityId === current.activityId,
    )
      ? current
      : null;
  }, [liveActivities, state?.activity]);

  const occupant = retainOccupant(
    occupantRef.current,
    liveCurrent,
    liveActivities,
  );
  occupantRef.current = occupant;

  const presence = useMemo(
    () =>
      resolvePresence(
        state,
        occupant,
        stickyHover,
        opened,
        settings.idleProvider.kind,
      ),
    [occupant, opened, settings.idleProvider.kind, state, stickyHover],
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
    occupant,
    state: state
      ? { ...state, activity: liveCurrent, activities: liveActivities }
      : state,
    settings,
    theme,
    catalog,
    customizing,
    setCustomizing,
    open,
    updateLayout,
    refresh,
  };
}
