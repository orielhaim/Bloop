import type { ActivitySnapshot, HomeLayout, PluginRecord } from "./types";

export type CatalogItem = {
  id: string;
  pluginId: string;
  name: string;
  iconUrl?: string | null;
  snapshot: ActivitySnapshot | null;
};

export function normalizeLayout(layout: HomeLayout): HomeLayout {
  return { items: layout.items ?? [] };
}

export function activityCatalog(
  plugins: PluginRecord[],
  activities: ActivitySnapshot[],
): CatalogItem[] {
  const items: CatalogItem[] = [];
  // Utility plugins present transiently and never occupy a home widget.
  const utilities = new Set(
    plugins
      .filter((plugin) => plugin.manifest?.provides?.widget === false)
      .map((plugin) => plugin.id),
  );
  for (const plugin of plugins) {
    if (
      !plugin.manifest?.provides?.activity ||
      plugin.enabled === false ||
      utilities.has(plugin.id)
    ) {
      continue;
    }
    const snapshot =
      activities.find((activity) => activity.pluginId === plugin.id) ?? null;
    items.push({
      id: plugin.id,
      pluginId: plugin.id,
      name: plugin.manifest.name,
      iconUrl: plugin.iconUrl,
      snapshot,
    });
  }
  for (const activity of activities) {
    if (utilities.has(activity.pluginId)) {
      continue;
    }
    if (items.some((item) => item.pluginId === activity.pluginId)) {
      continue;
    }
    items.push({
      id: activity.activityId,
      pluginId: activity.pluginId,
      name: activity.pluginId,
      snapshot: activity,
    });
  }
  return items;
}

export function pruneUnknownActivities(
  layout: HomeLayout,
  catalog: CatalogItem[],
): { layout: HomeLayout; dirty: boolean } {
  if (catalog.length === 0) {
    return { layout, dirty: false };
  }
  const known = catalogIds(catalog);
  const items = placedItems(layout).filter((id) => known.has(id));
  return {
    layout: { items },
    dirty: items.length !== placedItems(layout).length,
  };
}

export function placedItems(layout: HomeLayout): string[] {
  return normalizeLayout(layout).items;
}

export function unplacedCatalog(
  catalog: CatalogItem[],
  layout: HomeLayout,
): CatalogItem[] {
  const placed = new Set(placedItems(layout));
  return catalog.filter((item) => !isPlaced(item, placed));
}

function catalogIds(catalog: CatalogItem[]): Set<string> {
  return new Set(
    catalog.flatMap((item) =>
      [item.id, item.pluginId, item.snapshot?.activityId].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  );
}

function isPlaced(item: CatalogItem, placed: Set<string>): boolean {
  return (
    placed.has(item.id) ||
    placed.has(item.pluginId) ||
    Boolean(item.snapshot && placed.has(item.snapshot.activityId))
  );
}

export function catalogItem(
  catalog: CatalogItem[],
  id: string,
): CatalogItem | undefined {
  return catalog.find(
    (item) =>
      item.id === id ||
      item.pluginId === id ||
      item.snapshot?.activityId === id,
  );
}

export function sameActivity(left: string, right: string): boolean {
  return (
    left === right ||
    left.startsWith(`${right}.`) ||
    right.startsWith(`${left}.`)
  );
}
