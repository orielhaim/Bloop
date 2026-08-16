import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { normalizeLayout } from "./layout";
import type { EngineEvent } from "./types";
import {
  type AppSettings,
  fallbackSettings,
  fallbackTheme,
  type HomeLayout,
  type IslandState,
  type MonitorInfo,
  type PluginRecord,
  type Presence,
  type ThemeDocument,
} from "./types";

async function call<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    console.error(`engine.${command} failed`, error);
    return null;
  }
}

export const engine = {
  activities: {
    async state() {
      return await call<IslandState>("island_state");
    },
    async open() {
      return await call<IslandState>("island_open");
    },
    async collapse() {
      return await call<IslandState>("island_collapse");
    },
    async action(pluginId: string, actionId: string, payload = "") {
      await call("activity_action", { pluginId, actionId, payload });
    },
    async dismiss(activityId: string) {
      return await call<IslandState>("dismiss_activity", { activityId });
    },
  },
  plugins: {
    async list() {
      return (await call<PluginRecord[]>("list_plugins")) ?? [];
    },
    async enable(id: string) {
      return await call<PluginRecord>("enable_plugin", { id });
    },
    async disable(id: string) {
      return await call<PluginRecord>("disable_plugin", { id });
    },
    async reload(id: string) {
      return await call<PluginRecord>("reload_plugin", { id });
    },
    async uninstall(id: string) {
      await call("uninstall_plugin", { id });
    },
  },
  settings: {
    async get() {
      const settings =
        (await call<AppSettings>("get_settings")) ?? fallbackSettings;
      return {
        ...fallbackSettings,
        ...settings,
        layout: normalizeLayout(settings.layout),
      };
    },
    async update(settings: AppSettings) {
      return (
        (await call<AppSettings>("set_settings", { settings })) ?? settings
      );
    },
    async setLayout(layout: HomeLayout) {
      return (await call<HomeLayout>("set_layout", { layout })) ?? layout;
    },
  },
  themes: {
    async list() {
      return (await call<ThemeDocument[]>("list_themes")) ?? [fallbackTheme];
    },
    async current() {
      return (await call<ThemeDocument>("current_theme")) ?? fallbackTheme;
    },
    async activate(id: string) {
      return (
        (await call<ThemeDocument>("apply_theme", { id })) ?? fallbackTheme
      );
    },
  },
  media: {
    async artwork(sessionId: string) {
      return await call<string | null>("media_artwork", { sessionId });
    },
  },
  windows: {
    async monitors() {
      return (await call<MonitorInfo[]>("list_monitors")) ?? [];
    },
    async setPresence(mode: Presence, width: number, height: number) {
      await call("set_island_presence", { mode, width, height });
    },
  },
  updates: {
    async check() {
      return (
        (await call<{ available: boolean; version?: string; message: string }>(
          "check_updates",
        )) ?? {
          available: false,
          message: "Updates are not configured yet.",
        }
      );
    },
  },
  events: {
    async subscribe(
      handler: (event: EngineEvent) => void,
    ): Promise<UnlistenFn> {
      try {
        return await listen("engine-event", (event) =>
          handler(event.payload as EngineEvent),
        );
      } catch {
        return () => undefined;
      }
    },
  },
};

export type {
  ActivitySnapshot,
  AppSettings,
  HomeLayout,
  IdleProvider,
  IslandState,
  MonitorInfo,
  PluginRecord,
  Presence,
  ThemeDocument,
  UiNode,
} from "./types";
export { fallbackSettings, fallbackTheme } from "./types";
