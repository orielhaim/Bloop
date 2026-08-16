import { ArrowLeftIcon, ChevronRightIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { engine } from "@/lib/engine";
import type { AppSettings, PluginRecord } from "@/lib/engine/types";
import { cn } from "@/lib/utils";
import { kindLabel, pluginKinds } from "./kinds";
import { PluginMark } from "./plugin-mark";

type SettingsField = {
  type: string;
  key: string;
  label: string;
  description?: string | null;
  default?: unknown;
  min?: number;
  max?: number;
  step?: number;
};

export function PluginsPanel({
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
  const [openId, setOpenId] = useState<string | null>(null);
  const open = plugins.find((plugin) => plugin.id === openId) ?? null;

  const sorted = useMemo(() => {
    const byName = (left: PluginRecord, right: PluginRecord) =>
      left.manifest.name.localeCompare(right.manifest.name);
    return [
      ...plugins.filter((plugin) => plugin.enabled).sort(byName),
      ...plugins.filter((plugin) => !plugin.enabled).sort(byName),
    ];
  }, [plugins]);

  if (open) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-10 py-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-8">
          <Button
            variant="ghost"
            size="sm"
            className="w-fit"
            onClick={() => setOpenId(null)}
          >
            <ArrowLeftIcon data-icon="inline-start" />
            Plugins
          </Button>
          <PluginSettings
            plugin={open}
            settings={settings}
            onChange={onChange}
            onSave={onSave}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-10 py-10">
      <header>
        <h1 className="font-heading mt-1 text-3xl tracking-tight">Plugins</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Installed plugins that extend Bloop. Choose one to adjust its
          settings.
        </p>
      </header>
      <div className="flex flex-col gap-1 overflow-hidden rounded-2xl bg-white/3 ring-1 ring-white/6">
        {sorted.map((plugin) => (
          <button
            key={plugin.id}
            type="button"
            onClick={() => setOpenId(plugin.id)}
            className={cn(
              "group flex items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-white/5",
              !plugin.enabled && "opacity-50",
            )}
          >
            <PluginMark plugin={plugin} className="size-10" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {plugin.manifest.name}
              </span>
              <span className="block truncate text-xs text-zinc-500">
                {pluginKinds(plugin).map(kindLabel).join(" · ") || "Plugin"}
              </span>
            </span>
            <ChevronRightIcon className="size-4 shrink-0 text-zinc-600 transition-transform group-hover:translate-x-0.5" />
          </button>
        ))}
      </div>
    </div>
  );
}

function PluginSettings({
  plugin,
  settings,
  onChange,
  onSave,
}: {
  plugin: PluginRecord;
  settings: AppSettings;
  onChange: () => void;
  onSave: (settings: AppSettings) => Promise<void>;
}) {
  const schema = (plugin.manifest.settings_schema ?? []) as SettingsField[];
  const values = settings.pluginSettings[plugin.id] ?? {};
  const kinds = pluginKinds(plugin);

  const toggle = () => {
    void (
      plugin.enabled
        ? engine.plugins.disable(plugin.id)
        : engine.plugins.enable(plugin.id)
    ).then(() => onChange());
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-5">
        <PluginMark plugin={plugin} className="size-20" />
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            {kinds.map((item) => (
              <span
                key={item}
                className="rounded-full bg-white/8 px-2 py-0.5 text-[11px] text-zinc-400"
              >
                {kindLabel(item)}
              </span>
            ))}
          </div>
          <h2 className="font-heading mt-2 text-3xl tracking-tight">
            {plugin.manifest.name}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {plugin.manifest.author ?? "Unknown publisher"} ·{" "}
            {plugin.manifest.version}
          </p>
        </div>
      </div>
      <p className="text-sm leading-6 text-zinc-300">
        {plugin.manifest.description ?? "This plugin is bundled with Bloop."}
      </p>

      <section className="flex flex-col gap-1 overflow-visible rounded-2xl bg-white/3 ring-1 ring-white/6">
        <Row label="Enabled" hint="Allow this plugin to run.">
          <Switch
            checked={plugin.enabled}
            ariaLabel={`${plugin.manifest.name} enabled`}
            onCheckedChange={toggle}
          />
        </Row>
      </section>

      <section className="flex flex-col gap-1 overflow-visible rounded-2xl bg-white/3 ring-1 ring-white/6">
        <div className="px-5 pt-4">
          <p className="text-sm font-medium">Plugin settings</p>
          {!plugin.enabled ? (
            <p className="mt-1 text-xs text-zinc-500">
              Enable the plugin to change its settings.
            </p>
          ) : null}
        </div>
        <div
          className={cn(!plugin.enabled && "pointer-events-none opacity-50")}
        >
          {schema.length === 0 ? (
            <p className="px-5 pb-4 text-sm text-zinc-500">
              This plugin has no settings.
            </p>
          ) : (
            schema.map((field) => (
              <SettingField
                key={field.key}
                field={field}
                value={values[field.key]}
                disabled={!plugin.enabled}
                onChange={(value) => {
                  void onSave({
                    ...settings,
                    pluginSettings: {
                      ...settings.pluginSettings,
                      [plugin.id]: { ...values, [field.key]: value },
                    },
                  });
                }}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function SettingField({
  field,
  value,
  disabled,
  onChange,
}: {
  field: SettingsField;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <div>
        <p className="text-sm">{field.label}</p>
        {field.description ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {field.description}
          </p>
        ) : null}
      </div>
      {field.type === "boolean" ? (
        <Switch
          checked={Boolean(value ?? field.default)}
          disabled={disabled}
          onCheckedChange={onChange}
        />
      ) : field.type === "slider" ? (
        <input
          type="range"
          min={field.min ?? 0}
          max={field.max ?? 100}
          step={field.step ?? 1}
          className="w-48 accent-foreground"
          disabled={disabled}
          value={Number(value ?? field.default ?? 0)}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      ) : field.type === "number" ? (
        <Input
          type="number"
          className="max-w-48"
          disabled={disabled}
          value={String(value ?? field.default ?? "")}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      ) : (
        <Input
          className="max-w-48"
          disabled={disabled}
          value={String(value ?? field.default ?? "")}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
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
        <p className="text-sm font-medium">{label}</p>
        {hint ? <p className="mt-1 text-xs text-zinc-500">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}
