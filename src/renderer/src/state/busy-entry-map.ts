export type BusyScope = "app" | "viewport";

export interface BusyEntry {
  readonly id: string;
  readonly scope: BusyScope;
  readonly viewportIndex: number | null;
  readonly label: string;
  readonly progress: number | null;
  readonly registeredAtMs: number;
}

export interface BusyEntryUpdate {
  readonly label?: string;
  readonly progress?: number | null;
}

export type BusyEntryMap = ReadonlyMap<string, BusyEntry>;

export function addBusyEntryToMap(previous: BusyEntryMap, entry: BusyEntry): BusyEntryMap {
  const next = new Map(previous);
  next.set(entry.id, entry);
  return next;
}

export function removeBusyEntryFromMap(previous: BusyEntryMap, id: string): BusyEntryMap {
  if (!previous.has(id)) return previous;
  const next = new Map(previous);
  next.delete(id);
  return next;
}

export function updateBusyEntryInMap(
  previous: BusyEntryMap,
  id: string,
  patch: BusyEntryUpdate,
): BusyEntryMap {
  const existing = previous.get(id);
  if (!existing) return previous;
  const next = new Map(previous);
  next.set(id, mergeBusyEntryWithPatch(existing, patch));
  return next;
}

function mergeBusyEntryWithPatch(entry: BusyEntry, patch: BusyEntryUpdate): BusyEntry {
  return {
    ...entry,
    label: patch.label ?? entry.label,
    progress: patch.progress === undefined ? entry.progress : patch.progress,
  };
}

export function pickMostRecentAppBusyEntry(entries: BusyEntryMap): BusyEntry | null {
  return pickMostRecentEntryWithScopeAndViewport(entries, "app", null);
}

export function pickMostRecentViewportBusyEntry(
  entries: BusyEntryMap,
  viewportIndex: number,
): BusyEntry | null {
  return pickMostRecentEntryWithScopeAndViewport(entries, "viewport", viewportIndex);
}

function pickMostRecentEntryWithScopeAndViewport(
  entries: BusyEntryMap,
  scope: BusyScope,
  viewportIndex: number | null,
): BusyEntry | null {
  let mostRecent: BusyEntry | null = null;
  for (const entry of entries.values()) {
    if (entry.scope !== scope) continue;
    if (scope === "viewport" && entry.viewportIndex !== viewportIndex) continue;
    if (!mostRecent || entry.registeredAtMs > mostRecent.registeredAtMs) {
      mostRecent = entry;
    }
  }
  return mostRecent;
}
