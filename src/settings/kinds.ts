import type { PluginRecord } from "@/lib/engine/types";

export type PluginKind = "activity" | "theme" | "app";

export function pluginKinds(plugin: PluginRecord): PluginKind[] {
  const kinds: PluginKind[] = [];
  if (plugin.manifest.provides.activity) {
    kinds.push("activity");
  }
  if (plugin.manifest.provides.theme) {
    kinds.push("theme");
  }
  if (plugin.manifest.provides.app) {
    kinds.push("app");
  }
  return kinds;
}

export function kindLabel(kind: PluginKind) {
  switch (kind) {
    case "activity":
      return "Activity";
    case "theme":
      return "Theme";
    case "app":
      return "App";
  }
}

export function isBuiltin(plugin: PluginRecord) {
  return plugin.id.startsWith("bloop.");
}

export function sortPlugins(plugins: PluginRecord[]): PluginRecord[] {
  const byName = (left: PluginRecord, right: PluginRecord) =>
    left.manifest.name.localeCompare(right.manifest.name);
  return [
    ...plugins.filter((plugin) => plugin.enabled).sort(byName),
    ...plugins.filter((plugin) => !plugin.enabled).sort(byName),
  ];
}

export function matchesQuery(plugin: PluginRecord, query: string) {
  const haystack = [
    plugin.manifest.name,
    plugin.manifest.description ?? "",
    plugin.manifest.author ?? "",
    plugin.id,
    ...pluginKinds(plugin).map(kindLabel),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.trim().toLowerCase());
}
