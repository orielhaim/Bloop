export type EngineEvent =
  | { type: "pluginLoaded"; plugin: PluginRecord }
  | { type: "pluginUnloaded"; id: string }
  | { type: "pluginError"; id: string; message: string }
  | { type: "activityPublished"; snapshot: ActivitySnapshot }
  | { type: "activityUpdated"; snapshot: ActivitySnapshot }
  | { type: "activityDismissed"; activityId: string }
  | { type: "themeChanged"; id: string }
  | { type: "settingsChanged" }
  | { type: "displayChanged" }
  | { type: "fullscreenChanged"; hidden: boolean }
  | { type: "layoutChanged" }
  | { type: "presenceChanged" };

export type Presence = "resting" | "peek" | "presentation" | "expanded";

export type TextVariant = "body" | "title" | "kicker" | "numeric";
export type Align = "center" | "start" | "end" | "stretch";

export type UiNode =
  | { kind: "text"; text: string; variant?: TextVariant }
  | { kind: "secondaryText"; text: string }
  | { kind: "icon"; name: string }
  | { kind: "image"; src: string; alt?: string }
  | { kind: "artwork"; src: string; alt?: string }
  | { kind: "button"; id: string; label?: string; icon?: string }
  | {
      kind: "iconButton";
      id: string;
      icon: string;
      label?: string;
      size?: string;
    }
  | { kind: "progress"; value: number; max?: number }
  | { kind: "seekBar"; positionMs: number; durationMs: number; action: string }
  | { kind: "toggle"; id: string; on: boolean; label?: string }
  | { kind: "badge"; text: string }
  | { kind: "separator" }
  | { kind: "spacer"; size?: number; grow?: boolean }
  | { kind: "waveform"; active?: boolean }
  | { kind: "row"; children?: UiNode[]; gap?: number; align?: Align }
  | { kind: "column"; children?: UiNode[]; gap?: number }
  | { kind: "stack"; children?: UiNode[] };

export type ActivitySnapshot = {
  activityId: string;
  pluginId: string;
  priority: number;
  mode: "compact" | "peek" | "presentation" | "expanded";
  lifetimeMs?: number | null;
  interruptible: boolean;
  compact?: UiNode | null;
  peek?: UiNode | null;
  presentation?: UiNode | null;
  expanded?: UiNode | null;
  preview?: UiNode | null;
  timestampMs: number;
  coalescingKey?: string | null;
  preferredSize?: PreferredSize | null;
};

export type PreferredSize = "auto" | "compact" | "medium" | "wide";

export type IslandState = {
  presence: Presence;
  sticky: boolean;
  activity: ActivitySnapshot | null;
  activities: ActivitySnapshot[];
};

export type HomeLayout = { items: string[] };

export type MonitorPreference =
  | { mode: "primary" }
  | { mode: "selected"; id: string };

export type MonitorInfo = {
  id: string;
  name: string;
  primary: boolean;
};

export type IdleProvider =
  | { kind: "clock" }
  | { kind: "none" }
  | { kind: "media" }
  | { kind: "plugin"; id: string };

export type AppSettings = {
  islandEnabled: boolean;
  autostart: boolean;
  monitor: MonitorPreference;
  hideOnFullscreen: boolean;
  themeId: string;
  hoverOpenMs: number;
  hoverCloseMs: number;
  reducedMotion: boolean | null;
  enabledPlugins: Record<string, boolean>;
  layout: HomeLayout;
  pluginSettings: Record<string, Record<string, unknown>>;
  idleProvider: IdleProvider;
};

export type Spring = { stiffness: number; damping: number; mass: number };

export type ThemeDocument = {
  id: string;
  name: string;
  description?: string | null;
  tokens: {
    shell: string;
    foreground: string;
    muted: string;
    accent: string;
    surface: string;
    opacity: number;
    blur: number;
    border: string;
    shadow: string;
    radius: number;
  };
  motion: {
    peek: Spring;
    expand: Spring;
    collapse: Spring;
    contentEnterMs: number;
    contentExitMs: number;
    page: Spring;
    drag: Spring;
    activitySwitch: Spring;
  };
};

export type PluginRecord = {
  id: string;
  manifest: {
    id: string;
    name: string;
    version: string;
    author?: string | null;
    description?: string | null;
    icon?: string | null;
    provides: {
      activity: boolean;
      theme: boolean;
      app?: boolean;
      widget?: boolean;
    };
    permissions: {
      network: string[];
      storage: boolean;
      media: boolean;
      audio?: boolean;
      devices?: boolean;
    };
    homepage?: string | null;
    repository?: string | null;
    settings_schema: unknown[];
  };
  enabled: boolean;
  error?: string | null;
  iconUrl?: string | null;
  state: string;
};

export const fallbackTheme: ThemeDocument = {
  id: "bloop.theme.obsidian",
  name: "Obsidian",
  tokens: {
    shell: "#0a0a0a",
    foreground: "#f4f4f5",
    muted: "#a1a1aa",
    accent: "#5eead4",
    surface: "#18181b",
    opacity: 1,
    blur: 0,
    border: "transparent",
    shadow: "0 18px 40px rgb(0 0 0 / 35%)",
    radius: 28,
  },
  motion: {
    peek: { stiffness: 680, damping: 38, mass: 0.55 },
    expand: { stiffness: 420, damping: 30, mass: 0.72 },
    collapse: { stiffness: 580, damping: 40, mass: 0.52 },
    contentEnterMs: 160,
    contentExitMs: 120,
    page: { stiffness: 380, damping: 36, mass: 0.7 },
    drag: { stiffness: 500, damping: 32, mass: 0.6 },
    activitySwitch: { stiffness: 460, damping: 34, mass: 0.62 },
  },
};

export const fallbackSettings: AppSettings = {
  islandEnabled: true,
  autostart: false,
  monitor: { mode: "primary" },
  hideOnFullscreen: true,
  themeId: "bloop.theme.obsidian",
  hoverOpenMs: 100,
  hoverCloseMs: 240,
  reducedMotion: null,
  enabledPlugins: {},
  layout: { items: [] },
  pluginSettings: {},
  idleProvider: { kind: "clock" },
};
