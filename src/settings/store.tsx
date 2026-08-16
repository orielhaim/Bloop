import {
  ArrowLeftIcon,
  BluetoothIcon,
  CheckIcon,
  GlobeIcon,
  HardDriveIcon,
  RadioIcon,
  RefreshCwIcon,
  SearchIcon,
  ShieldIcon,
  Volume2Icon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { ActionSwapCascadeButton } from "@/components/ui/action-swap-cascade";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { engine } from "@/lib/engine";
import type { AppSettings, PluginRecord } from "@/lib/engine/types";
import { cn } from "@/lib/utils";
import {
  isBuiltin,
  kindLabel,
  matchesQuery,
  type PluginKind,
  pluginKinds,
} from "./kinds";

type StoreShelf = "discover" | "library" | "updates";

export function PluginStore({
  plugins,
  settings,
  onChange,
  onSave,
}: {
  plugins: PluginRecord[];
  settings: AppSettings;
  onChange: () => void;
  onSave: (settings: AppSettings) => Promise<void>;
}) {
  const [shelf, setShelf] = useState<StoreShelf>("discover");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<PluginKind | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const open = plugins.find((plugin) => plugin.id === openId) ?? null;
  const filtered = useMemo(() => {
    return plugins
      .filter((plugin) => kind === "all" || pluginKinds(plugin).includes(kind))
      .filter((plugin) => matchesQuery(plugin, query))
      .sort((left, right) =>
        left.manifest.name.localeCompare(right.manifest.name),
      );
  }, [kind, plugins, query]);
  const installed = filtered.filter((plugin) => plugin.enabled);
  const featured = filtered[0] ?? null;

  if (open) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-10 py-8">
        <PluginProduct
          plugin={open}
          settings={settings}
          onBack={() => setOpenId(null)}
          onChange={onChange}
          onSave={onSave}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="z-20 shrink-0 border-b border-white/6 bg-[#0b0b0d]/90 px-10 pt-8 pb-4 backdrop-blur-md">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="font-heading text-3xl tracking-tight">Store</h2>
          <div className="relative w-full max-w-sm">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search activities, themes, apps"
              className="h-10 rounded-full bg-input/40 pl-9"
            />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Tabs
            value={shelf}
            onValueChange={(value) => setShelf(value as StoreShelf)}
            variant="pill"
          >
            <TabsList>
              <TabsTrigger value="discover">Discover</TabsTrigger>
              <TabsTrigger value="library">Installed</TabsTrigger>
              <TabsTrigger value="updates">Updates</TabsTrigger>
            </TabsList>
          </Tabs>
          <Select
            value={kind}
            onValueChange={(value) => setKind(value as PluginKind | "all")}
            className="w-40"
          >
            <SelectTrigger>
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="activity">Activity</SelectItem>
              <SelectItem value="theme">Theme</SelectItem>
              <SelectItem value="app">App</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-10 py-8">
        {shelf === "updates" ? (
          <Empty className="min-h-64 border border-dashed">
            <EmptyHeader>
              <EmptyTitle>Everything is current</EmptyTitle>
              <EmptyDescription>
                Builtin plugins ship with Bloop. When a catalog is connected,
                available updates will land here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {shelf === "discover" && featured ? (
          <button
            type="button"
            onClick={() => setOpenId(featured.id)}
            className="relative overflow-hidden rounded-3xl bg-linear-to-br from-zinc-800 to-zinc-950 p-8 text-left ring-1 ring-white/10"
          >
            <p className="text-[11px] tracking-[0.2em] text-zinc-400 uppercase">
              Featured
            </p>
            <div className="mt-6 flex items-end justify-between gap-6">
              <div className="min-w-0">
                <h3 className="font-heading text-4xl tracking-tight">
                  {featured.manifest.name}
                </h3>
                <p className="mt-2 max-w-xl text-sm text-zinc-400">
                  {featured.manifest.description ?? "Included with Bloop."}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {pluginKinds(featured).map((item) => (
                    <Badge key={item} variant="secondary">
                      {kindLabel(item)}
                    </Badge>
                  ))}
                  <Badge variant="outline">Included</Badge>
                </div>
              </div>
              <PluginMark plugin={featured} className="size-24" />
            </div>
          </button>
        ) : null}

        {shelf !== "updates" ? (
          <div>
            <h3 className="mb-4 text-sm font-medium text-muted-foreground">
              {shelf === "library" ? "On this device" : "Catalog"}
            </h3>
            {(shelf === "library" ? installed : filtered).length === 0 ? (
              <Empty className="min-h-48 border border-dashed">
                <EmptyHeader>
                  <EmptyTitle>Nothing here yet</EmptyTitle>
                  <EmptyDescription>
                    {shelf === "library"
                      ? "Enable a plugin from Discover to see it in your library."
                      : "No plugins match that search."}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {(shelf === "library" ? installed : filtered).map((plugin) => (
                  <button
                    key={plugin.id}
                    type="button"
                    onClick={() => setOpenId(plugin.id)}
                    className="group flex flex-col gap-4 rounded-2xl bg-card/80 p-4 text-left ring-1 ring-foreground/8 transition-colors hover:bg-card hover:ring-foreground/16"
                  >
                    <PluginMark plugin={plugin} className="size-14" />
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {plugin.manifest.name}
                      </p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {pluginKinds(plugin).map(kindLabel).join(" · ") ||
                          "Plugin"}
                      </p>
                    </div>
                    <div className="mt-auto flex items-center justify-between gap-2">
                      <Badge variant={plugin.enabled ? "secondary" : "outline"}>
                        {plugin.enabled ? "On" : "Off"}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">
                        v{plugin.manifest.version}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PluginProduct({
  plugin,
  settings,
  onBack,
  onChange,
  onSave,
}: {
  plugin: PluginRecord;
  settings: AppSettings;
  onBack: () => void;
  onChange: () => void;
  onSave: (settings: AppSettings) => Promise<void>;
}) {
  const schema = (plugin.manifest.settings_schema ?? []) as {
    type: string;
    key: string;
    label: string;
    description?: string | null;
    default?: unknown;
    min?: number;
    max?: number;
    step?: number;
  }[];
  const values = settings.pluginSettings[plugin.id] ?? {};
  const kinds = pluginKinds(plugin);
  const permissions = [
    plugin.manifest.permissions.media
      ? {
          icon: RadioIcon,
          label: "Media session",
          detail: "Read the current playback session.",
        }
      : null,
    plugin.manifest.permissions.audio
      ? {
          icon: Volume2Icon,
          label: "Audio",
          detail: "Read and control the system volume.",
        }
      : null,
    plugin.manifest.permissions.devices
      ? {
          icon: BluetoothIcon,
          label: "Devices",
          detail: "Observe Bluetooth and device connection state.",
        }
      : null,
    plugin.manifest.permissions.storage
      ? {
          icon: HardDriveIcon,
          label: "Storage",
          detail: "Keep plugin data on this device.",
        }
      : null,
    ...plugin.manifest.permissions.network.map((host) => ({
      icon: GlobeIcon,
      label: "Network",
      detail: host,
    })),
  ].filter((item) => item !== null);

  return (
    <div className="flex flex-col gap-8">
      <Button variant="ghost" size="sm" className="w-fit" onClick={onBack}>
        <ArrowLeftIcon data-icon="inline-start" />
        Store
      </Button>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_320px]">
        <div className="overflow-hidden rounded-3xl bg-zinc-900 ring-1 ring-white/8">
          <div className="flex min-h-72 items-center justify-center bg-linear-to-b from-zinc-800/80 to-zinc-950">
            <PluginMark plugin={plugin} className="size-28" />
          </div>
        </div>
        <div className="flex flex-col gap-5">
          <div>
            <div className="flex flex-wrap gap-2">
              {kinds.map((item) => (
                <Badge key={item} variant="secondary">
                  {kindLabel(item)}
                </Badge>
              ))}
              <Badge variant="outline">Included</Badge>
            </div>
            <h2 className="font-heading mt-3 text-4xl tracking-tight">
              {plugin.manifest.name}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {plugin.manifest.author ?? "Unknown publisher"} ·{" "}
              {plugin.manifest.version}
            </p>
          </div>
          <p className="text-sm leading-6 text-zinc-300">
            {plugin.manifest.description ??
              "This plugin is bundled with Bloop."}
          </p>
          <div className="flex flex-wrap gap-2">
            {isBuiltin(plugin) ? (
              <ActionSwapCascadeButton
                variant={plugin.enabled ? "outline" : "primary"}
                items={[
                  { id: "off", label: "Enable" },
                  { id: "on", label: "Disable" },
                ]}
                value={plugin.enabled ? "on" : "off"}
                cycle={false}
                onClick={() => {
                  void (
                    plugin.enabled
                      ? engine.plugins.disable(plugin.id)
                      : engine.plugins.enable(plugin.id)
                  ).then(() => onChange());
                }}
              />
            ) : (
              <Button
                onClick={() =>
                  void engine.plugins.enable(plugin.id).then(onChange)
                }
              >
                Get
              </Button>
            )}
            <ReloadButton
              onReload={() => engine.plugins.reload(plugin.id).then(onChange)}
            />
          </div>
          {plugin.error ? (
            <p className="text-xs text-muted-foreground">{plugin.error}</p>
          ) : null}
        </div>
      </div>
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl bg-card/70 p-5 ring-1 ring-foreground/8">
          <div className="mb-4 flex items-center gap-2 text-sm font-medium">
            <ShieldIcon className="size-4" />
            Permissions
          </div>
          {permissions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This plugin does not request special access.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {permissions.map((item) => (
                <li key={`${item.label}-${item.detail}`} className="flex gap-3">
                  <item.icon className="mt-0.5 size-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.detail}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-2xl bg-card/70 p-5 ring-1 ring-foreground/8">
          <p className="mb-4 text-sm font-medium">Details</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Publisher</dt>
            <dd>{plugin.manifest.author ?? "—"}</dd>
            <dt className="text-muted-foreground">Identifier</dt>
            <dd className="truncate">{plugin.id}</dd>
            <dt className="text-muted-foreground">Version</dt>
            <dd>{plugin.manifest.version}</dd>
            <dt className="text-muted-foreground">Source</dt>
            <dd>Builtin catalog</dd>
          </dl>
        </div>
      </section>
      {plugin.enabled && schema.length > 0 ? (
        <section className="rounded-2xl bg-card/70 p-5 ring-1 ring-foreground/8">
          <p className="mb-4 text-sm font-medium">Plugin settings</p>
          <div className="flex flex-col gap-4">
            {schema.map((field) => (
              <div
                key={field.key}
                className="flex items-center justify-between gap-4"
              >
                <div>
                  <p className="text-sm">{field.label}</p>
                  {field.description ? (
                    <p className="text-xs text-muted-foreground">
                      {field.description}
                    </p>
                  ) : null}
                </div>
                {field.type === "boolean" ? (
                  <Switch
                    checked={Boolean(values[field.key] ?? field.default)}
                    onCheckedChange={(on) => {
                      void onSave({
                        ...settings,
                        pluginSettings: {
                          ...settings.pluginSettings,
                          [plugin.id]: { ...values, [field.key]: on },
                        },
                      });
                    }}
                  />
                ) : field.type === "slider" ? (
                  <input
                    type="range"
                    min={field.min ?? 0}
                    max={field.max ?? 100}
                    step={field.step ?? 1}
                    className="w-48 accent-foreground"
                    value={Number(values[field.key] ?? field.default ?? 0)}
                    onChange={(event) => {
                      void onSave({
                        ...settings,
                        pluginSettings: {
                          ...settings.pluginSettings,
                          [plugin.id]: {
                            ...values,
                            [field.key]: Number(event.target.value),
                          },
                        },
                      });
                    }}
                  />
                ) : field.type === "number" ? (
                  <Input
                    type="number"
                    className="max-w-48"
                    value={String(values[field.key] ?? field.default ?? "")}
                    onChange={(event) => {
                      void onSave({
                        ...settings,
                        pluginSettings: {
                          ...settings.pluginSettings,
                          [plugin.id]: {
                            ...values,
                            [field.key]: Number(event.target.value),
                          },
                        },
                      });
                    }}
                  />
                ) : (
                  <Input
                    className="max-w-48"
                    value={String(values[field.key] ?? field.default ?? "")}
                    onChange={(event) => {
                      void onSave({
                        ...settings,
                        pluginSettings: {
                          ...settings.pluginSettings,
                          [plugin.id]: {
                            ...values,
                            [field.key]: event.target.value,
                          },
                        },
                      });
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ReloadButton({ onReload }: { onReload: () => Promise<unknown> }) {
  const [spinning, setSpinning] = useState(false);

  return (
    <Button
      variant="outline"
      size="icon"
      aria-label="Reload plugin"
      className="size-9 rounded-full"
      disabled={spinning}
      onClick={() => {
        setSpinning(true);
        const started = Date.now();
        void onReload().finally(() => {
          const wait = Math.max(0, 600 - (Date.now() - started));
          window.setTimeout(() => setSpinning(false), wait);
        });
      }}
    >
      <RefreshCwIcon className={cn("size-4", spinning && "animate-spin")} />
    </Button>
  );
}

function PluginMark({
  plugin,
  className,
}: {
  plugin: PluginRecord;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center justify-center overflow-hidden rounded-2xl bg-zinc-800 ring-1 ring-white/10 ${className ?? "size-14"}`}
    >
      {plugin.iconUrl ? (
        <img src={plugin.iconUrl} alt="" className="size-2/3 object-contain" />
      ) : (
        <CheckIcon className="size-6 text-zinc-500" />
      )}
    </div>
  );
}
