import { useQueryClient } from "@tanstack/react-query";
import {
  BlocksIcon,
  InfoIcon,
  PaletteIcon,
  Settings2Icon,
  StoreIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { applyTheme } from "@/animation/tokens";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { engine } from "@/lib/engine";
import {
  queryKeys,
  useEngineEventInvalidation,
  useMonitorsQuery,
  usePluginsQuery,
  useSettingsQuery,
  useThemesQuery,
} from "@/lib/engine/query";
import {
  type AppSettings,
  fallbackSettings,
  type IdleProvider,
  type MonitorInfo,
  type PluginRecord,
  type ThemeDocument,
} from "@/lib/engine/types";
import { cn } from "@/lib/utils";
import { sortPlugins } from "./kinds";
import { PluginMark } from "./plugin-mark";
import { PluginSettings } from "./plugins";
import { PluginStore } from "./store";

type Section = "island" | "appearance" | "plugins" | "store" | "about";

export function SettingsApp() {
  const [section, setSection] = useState<Section>("island");
  const [pluginId, setPluginId] = useState<string | null>(null);
  const [updateMessage, setUpdateMessage] = useState("Not checked yet.");
  const queryClient = useQueryClient();

  const settingsQuery = useSettingsQuery();
  const pluginsQuery = usePluginsQuery();
  const themesQuery = useThemesQuery();
  const monitorsQuery = useMonitorsQuery();
  useEngineEventInvalidation();

  const settings = settingsQuery.data ?? fallbackSettings;
  const plugins = pluginsQuery.data ?? [];
  const themes = themesQuery.data ?? [];
  const monitors = monitorsQuery.data ?? [];

  const sidebarPlugins = useMemo(() => sortPlugins(plugins), [plugins]);
  const selectedPlugin =
    plugins.find((plugin) => plugin.id === pluginId) ?? null;

  const activeTheme = useMemo(() => {
    const visible = visibleThemes(themes, plugins);
    return (
      visible.find((item) => item.id === settings.themeId) ??
      visible[0] ??
      themes[0] ??
      null
    );
  }, [plugins, settings.themeId, themes]);

  useEffect(() => {
    document.documentElement.classList.add("dark", "settings-surface");
  }, []);

  useEffect(() => {
    if (activeTheme) {
      applyTheme(activeTheme);
    }
  }, [activeTheme]);

  const save = async (next: AppSettings) => {
    await engine.settings.update(next);
    await queryClient.invalidateQueries({ queryKey: queryKeys.settings });
    await queryClient.invalidateQueries({ queryKey: queryKeys.plugins });
  };

  const select = (id: Section) => {
    setSection(id);
    setPluginId(null);
  };

  const appearanceThemes = useMemo(
    () => visibleThemes(themes, plugins),
    [plugins, themes],
  );

  return (
    <div className="flex h-full min-h-0 bg-[#0b0b0d] text-zinc-100">
      <nav className="flex h-full w-56 shrink-0 flex-col border-r border-white/6 bg-black/40">
        <div className="flex shrink-0 flex-col gap-1 p-4 pb-2">
          <NavButton
            active={section === "island"}
            onClick={() => select("island")}
            icon={<Settings2Icon className="size-4" />}
            label="Island"
          />
          <NavButton
            active={section === "appearance"}
            onClick={() => select("appearance")}
            icon={<PaletteIcon className="size-4" />}
            label="Appearance"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
          <p
            className={cn(
              "px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider",
              section === "plugins" ? "text-zinc-300" : "text-zinc-500",
            )}
          >
            Plugins
          </p>
          <div className="flex flex-col gap-1">
            {sidebarPlugins.map((plugin) => (
              <button
                key={plugin.id}
                type="button"
                onClick={() => {
                  setSection("plugins");
                  setPluginId(plugin.id);
                }}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  section === "plugins" && pluginId === plugin.id
                    ? "bg-white/10 text-white"
                    : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200",
                  !plugin.enabled && "opacity-50",
                )}
              >
                <PluginMark plugin={plugin} className="size-7" />
                <span className="truncate">{plugin.manifest.name}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-1 p-4 pt-2">
          <NavButton
            active={section === "store"}
            onClick={() => select("store")}
            icon={<StoreIcon className="size-4" />}
            label="Store"
          />
          <NavButton
            active={section === "about"}
            onClick={() => select("about")}
            icon={<InfoIcon className="size-4" />}
            label="About"
          />
        </div>
      </nav>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {section === "store" ? (
          <PluginStore
            plugins={plugins}
            onChange={() => {
              void queryClient.invalidateQueries({
                queryKey: queryKeys.plugins,
              });
              void queryClient.invalidateQueries({
                queryKey: queryKeys.themes,
              });
            }}
          />
        ) : section === "plugins" ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-10 py-8">
            <div className="mx-auto flex max-w-3xl flex-col gap-8">
              {selectedPlugin ? (
                <PluginSettings
                  plugin={selectedPlugin}
                  settings={settings}
                  onChange={() => {
                    void queryClient.invalidateQueries({
                      queryKey: queryKeys.plugins,
                    });
                    void queryClient.invalidateQueries({
                      queryKey: queryKeys.themes,
                    });
                  }}
                  onSave={save}
                />
              ) : (
                <div className="flex flex-col items-center py-24 text-center">
                  <BlocksIcon className="size-10 text-zinc-600" />
                  <p className="mt-3 text-sm font-medium text-zinc-300">
                    {plugins.length === 0
                      ? "No plugins installed"
                      : "No plugin selected"}
                  </p>
                  <p className="mt-1 text-sm text-zinc-500">
                    {plugins.length === 0
                      ? "Browse the Store to add some."
                      : "Choose a plugin from the sidebar to adjust its settings."}
                  </p>
                  {plugins.length === 0 ? (
                    <Button
                      variant="outline"
                      className="mt-4"
                      onClick={() => select("store")}
                    >
                      Open Store
                    </Button>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-10 py-10">
            {section === "island" ? (
              <IslandPanel
                settings={settings}
                plugins={plugins}
                monitors={monitors}
                onSave={save}
              />
            ) : null}
            {section === "appearance" ? (
              <AppearancePanel
                settings={settings}
                themes={appearanceThemes}
                onSave={save}
                onRefresh={() => {
                  void queryClient.invalidateQueries({
                    queryKey: queryKeys.themes,
                  });
                  void queryClient.invalidateQueries({
                    queryKey: queryKeys.settings,
                  });
                }}
              />
            ) : null}
            {section === "about" ? (
              <AboutPanel
                message={updateMessage}
                onMessage={setUpdateMessage}
              />
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}

function visibleThemes(themes: ThemeDocument[], plugins: PluginRecord[]) {
  const enabled = new Set(
    plugins
      .filter((plugin) => plugin.enabled && plugin.manifest.provides.theme)
      .map((plugin) => plugin.id),
  );
  return themes.filter(
    (theme) => theme.id === "bloop.theme.obsidian" || enabled.has(theme.id),
  );
}

function IslandPanel({
  settings,
  plugins,
  monitors,
  onSave,
}: {
  settings: AppSettings;
  plugins: PluginRecord[];
  monitors: MonitorInfo[];
  onSave: (settings: AppSettings) => Promise<void>;
}) {
  const clock = settings.clock ?? fallbackSettings.clock;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10">
      <header>
        <h1 className="font-heading mt-1 text-3xl tracking-tight">Island</h1>
      </header>
      <section className="flex flex-col gap-1 overflow-visible rounded-2xl bg-white/3 ring-1 ring-white/6">
        <Row
          label="Show island"
          hint="Keep the overlay on the selected display."
        >
          <Switch
            checked={settings.islandEnabled}
            onCheckedChange={(islandEnabled) =>
              onSave({ ...settings, islandEnabled })
            }
          />
        </Row>
        <Row label="Open at login" hint="Start Bloop when Windows signs in.">
          <Switch
            checked={settings.autostart}
            onCheckedChange={(autostart) => onSave({ ...settings, autostart })}
          />
        </Row>
        <Row
          label="Hide on fullscreen"
          hint="Step aside for games and exclusive apps."
        >
          <Switch
            checked={settings.hideOnFullscreen}
            onCheckedChange={(hideOnFullscreen) =>
              onSave({ ...settings, hideOnFullscreen })
            }
          />
        </Row>
      </section>
      <section className="flex flex-col gap-1 overflow-visible rounded-2xl bg-white/3 ring-1 ring-white/6">
        <Row label="Display" hint="Which monitor the island lives on.">
          <Select
            value={
              settings.monitor.mode === "selected"
                ? settings.monitor.id
                : "primary"
            }
            onValueChange={(value) => {
              void onSave({
                ...settings,
                monitor:
                  value === "primary"
                    ? { mode: "primary" }
                    : { mode: "selected", id: value },
              });
            }}
            className="w-64"
          >
            <SelectTrigger>
              <SelectValue placeholder="Display" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="primary">Primary display</SelectItem>
              {monitors.map((monitor) => (
                <SelectItem key={monitor.id} value={monitor.id}>
                  {`${monitor.name}${monitor.primary ? " (primary)" : ""}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row
          label="Idle content"
          hint="What the island shows when nothing occupies it."
        >
          <Combobox
            value={idleSelectValue(settings.idleProvider)}
            onValueChange={(value) =>
              void onSave({ ...settings, idleProvider: idleFromSelect(value) })
            }
            className="w-64"
          >
            <ComboboxTrigger>
              <ComboboxInput placeholder="Search idle content" />
            </ComboboxTrigger>
            <ComboboxContent>
              <ComboboxList>
                <ComboboxItem value="clock">Clock</ComboboxItem>
                <ComboboxItem value="none">Nothing</ComboboxItem>
                <ComboboxItem value="media">Current media</ComboboxItem>
                {plugins
                  .filter(
                    (plugin) =>
                      plugin.enabled &&
                      plugin.manifest.provides.activity &&
                      plugin.manifest.provides.widget !== false,
                  )
                  .map((plugin) => (
                    <ComboboxItem key={plugin.id} value={`plugin:${plugin.id}`}>
                      {plugin.manifest.name}
                    </ComboboxItem>
                  ))}
                <ComboboxEmpty>No matches</ComboboxEmpty>
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </Row>
        <Row
          label="Clock seconds"
          hint="Show hours:minutes:seconds on the idle clock."
        >
          <Switch
            checked={clock.showSeconds}
            onCheckedChange={(showSeconds) =>
              onSave({
                ...settings,
                clock: { ...clock, showSeconds },
              })
            }
          />
        </Row>
        <Row
          label="Clock motion"
          hint="Tick rolls each digit. Smooth crossfades the time."
        >
          <Select
            value={clock.motion}
            onValueChange={(value) =>
              void onSave({
                ...settings,
                clock: {
                  ...clock,
                  motion: value === "smooth" ? "smooth" : "tick",
                },
              })
            }
            className="w-40"
          >
            <SelectTrigger>
              <SelectValue placeholder="Motion" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tick">Tick</SelectItem>
              <SelectItem value="smooth">Smooth</SelectItem>
            </SelectContent>
          </Select>
        </Row>
      </section>
      <section className="flex flex-col gap-1 overflow-visible rounded-2xl bg-white/3 ring-1 ring-white/6">
        <Row label="Hover open (ms)">
          <input
            type="number"
            className="h-8 w-24 rounded-lg border border-input bg-input/30 px-2 text-sm"
            value={settings.hoverOpenMs}
            onChange={(event) =>
              void onSave({
                ...settings,
                hoverOpenMs: Number(event.target.value),
              })
            }
          />
        </Row>
        <Row label="Hover close (ms)">
          <input
            type="number"
            className="h-8 w-24 rounded-lg border border-input bg-input/30 px-2 text-sm"
            value={settings.hoverCloseMs}
            onChange={(event) =>
              void onSave({
                ...settings,
                hoverCloseMs: Number(event.target.value),
              })
            }
          />
        </Row>
      </section>
    </div>
  );
}

function AppearancePanel({
  settings,
  themes,
  onSave,
  onRefresh,
}: {
  settings: AppSettings;
  themes: ThemeDocument[];
  onSave: (settings: AppSettings) => Promise<void>;
  onRefresh: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10">
      <header>
        <h1 className="font-heading mt-1 text-3xl tracking-tight">
          Appearance
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          Only themes from enabled theme plugins are listed here.
        </p>
      </header>
      <div className="grid grid-cols-2 gap-3">
        {themes.map((theme) => (
          <button
            key={theme.id}
            type="button"
            onClick={() =>
              void engine.themes.activate(theme.id).then(onRefresh)
            }
            className={`flex items-center gap-3 rounded-2xl p-3 text-left ring-1 transition-colors ${
              theme.id === settings.themeId
                ? "bg-white/8 ring-white/30"
                : "bg-white/3 ring-white/8 hover:bg-white/6"
            }`}
          >
            <span
              className="size-10 rounded-full ring-1 ring-white/10"
              style={{
                background: theme.tokens.shell,
                boxShadow: `inset 0 0 0 3px ${theme.tokens.accent}`,
              }}
            />
            <span>
              <span className="block text-sm font-medium">{theme.name}</span>
              <span className="block text-xs text-zinc-500">
                {theme.description ?? theme.id}
              </span>
            </span>
          </button>
        ))}
      </div>
      <section className="flex flex-col gap-1 overflow-visible rounded-2xl bg-white/3 ring-1 ring-white/6">
        <Row label="Follow system reduced motion">
          <Switch
            checked={settings.reducedMotion === null}
            onCheckedChange={(on) =>
              onSave({ ...settings, reducedMotion: on ? null : false })
            }
          />
        </Row>
        <Row label="Reduce motion">
          <Switch
            checked={settings.reducedMotion === true}
            disabled={settings.reducedMotion === null}
            onCheckedChange={(reducedMotion) =>
              onSave({ ...settings, reducedMotion })
            }
          />
        </Row>
      </section>
      <section className="flex flex-col gap-1 overflow-visible rounded-2xl bg-white/3 ring-1 ring-white/6">
        <Row
          label="Island information"
          hint="How much the island shows at once. The engine still decides what is relevant."
        >
          <Select
            value={settings.composition ?? "auto"}
            onValueChange={(value) =>
              onSave({
                ...settings,
                composition: (value as "auto" | "minimal" | "rich") ?? "auto",
              })
            }
            className="w-48"
          >
            <SelectTrigger>
              <SelectValue placeholder="Automatic" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Automatic</SelectItem>
              <SelectItem value="minimal">Less information</SelectItem>
              <SelectItem value="rich">More information</SelectItem>
            </SelectContent>
          </Select>
        </Row>
      </section>
    </div>
  );
}

function AboutPanel({
  message,
  onMessage,
}: {
  message: string;
  onMessage: (value: string) => void;
}) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <header>
        <h1 className="font-heading mt-1 text-3xl tracking-tight">About</h1>
      </header>
      <div className="rounded-2xl bg-white/3 p-6 ring-1 ring-white/6">
        <p className="text-lg font-medium">Bloop 0.1.0</p>
        <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-400">
          The island is an engine. Activities, themes, and apps arrive as
          plugins. The Store lists what is already on this machine; a remote
          catalog can plug into the same shelves later.
        </p>
        <div className="mt-6 flex items-center justify-between gap-4">
          <p className="text-xs text-zinc-500">{message}</p>
          <Button
            variant="outline"
            onClick={() => {
              void engine.updates
                .check()
                .then((result) => onMessage(result.message));
            }}
          >
            Check for updates
          </Button>
        </div>
      </div>
    </div>
  );
}

function idleSelectValue(provider: IdleProvider) {
  return provider.kind === "plugin" ? `plugin:${provider.id}` : provider.kind;
}

function idleFromSelect(value: string): IdleProvider {
  if (value === "none" || value === "media" || value === "clock") {
    return { kind: value };
  }
  if (value.startsWith("plugin:")) {
    return { kind: "plugin", id: value.slice(7) };
  }
  return { kind: "clock" };
}

function NavButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
        active
          ? "bg-white/10 text-white"
          : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="relative z-20 flex items-center justify-between gap-6 overflow-visible px-5 py-4">
      <div>
        <Label>{label}</Label>
        {hint ? <p className="mt-1 text-xs text-zinc-500">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}
