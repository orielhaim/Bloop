import {
  type QueryClient,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";
import { engine } from "./index";
import type { EngineEvent } from "./types";

/** Query keys backing the settings surface; invalidated on specific events. */
export const queryKeys = {
  settings: ["settings"] as const,
  plugins: ["plugins"] as const,
  themes: ["themes"] as const,
  monitors: ["monitors"] as const,
};

/** Invalidate only the queries an engine event can actually affect. */
export function invalidateForEvent(client: QueryClient, event: EngineEvent) {
  switch (event.type) {
    case "pluginLoaded":
    case "pluginUnloaded":
    case "pluginError":
      client.invalidateQueries({ queryKey: queryKeys.plugins });
      client.invalidateQueries({ queryKey: queryKeys.settings });
      break;
    case "themeChanged":
      client.invalidateQueries({ queryKey: queryKeys.themes });
      client.invalidateQueries({ queryKey: queryKeys.settings });
      break;
    case "settingsChanged":
    case "layoutChanged":
      client.invalidateQueries({ queryKey: queryKeys.settings });
      break;
    case "displayChanged":
      client.invalidateQueries({ queryKey: queryKeys.monitors });
      break;
    default:
      // Activity/presence events drive the island's live refresh; the settings
      // surface does not need to re-fetch for those.
      break;
  }
}

/** Subscribe to engine events and invalidate the affected query keys. */
export function useEngineEventInvalidation() {
  const client = useQueryClient();
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void engine.events
      .subscribe((event) => {
        invalidateForEvent(client, event);
      })
      .then((stop) => {
        if (cancelled) {
          stop();
        } else {
          unlisten = stop;
        }
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [client]);
}

export function useSettingsQuery() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => engine.settings.get(),
  });
}

export function usePluginsQuery() {
  return useQuery({
    queryKey: queryKeys.plugins,
    queryFn: () => engine.plugins.list(),
  });
}

export function useThemesQuery() {
  return useQuery({
    queryKey: queryKeys.themes,
    queryFn: () => engine.themes.list(),
  });
}

export function useMonitorsQuery() {
  return useQuery({
    queryKey: queryKeys.monitors,
    queryFn: () => engine.windows.monitors(),
  });
}
