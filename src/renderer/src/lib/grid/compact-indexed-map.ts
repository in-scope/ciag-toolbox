export function compactIndexedMapAfterRemovingIndex<T>(
  map: ReadonlyMap<number, T>,
  removedIndex: number,
): ReadonlyMap<number, T> {
  const next = new Map<number, T>();
  for (const [index, value] of map) {
    if (index === removedIndex) continue;
    next.set(index > removedIndex ? index - 1 : index, value);
  }
  return next;
}

export function compactIndexedSetAfterRemovingIndex(
  set: ReadonlySet<number>,
  removedIndex: number,
): ReadonlySet<number> {
  const next = new Set<number>();
  for (const index of set) {
    if (index === removedIndex) continue;
    next.add(index > removedIndex ? index - 1 : index);
  }
  return next;
}

export function compactAnchorAfterRemovingIndex(
  anchor: number | null,
  removedIndex: number,
): number | null {
  if (anchor === null) return null;
  if (anchor === removedIndex) return null;
  return anchor > removedIndex ? anchor - 1 : anchor;
}
