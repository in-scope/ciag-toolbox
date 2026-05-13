export function buildInitialKeptBandSetFromRemoved(
  bandCount: number,
  removedBandIndexes: ReadonlyArray<number>,
): ReadonlySet<number> {
  const kept = new Set<number>();
  const removed = new Set(removedBandIndexes);
  for (let bandIndex = 0; bandIndex < bandCount; bandIndex += 1) {
    if (!removed.has(bandIndex)) kept.add(bandIndex);
  }
  return kept;
}

export function listRemovedBandIndexesFromKeptSet(
  bandCount: number,
  keptBandIndexes: ReadonlySet<number>,
): ReadonlyArray<number> {
  const removed: number[] = [];
  for (let bandIndex = 0; bandIndex < bandCount; bandIndex += 1) {
    if (!keptBandIndexes.has(bandIndex)) removed.push(bandIndex);
  }
  return removed;
}

export function toggleBandIndexInKeptSet(
  keptBandIndexes: ReadonlySet<number>,
  bandIndex: number,
): ReadonlySet<number> {
  const next = new Set(keptBandIndexes);
  if (next.has(bandIndex)) next.delete(bandIndex);
  else next.add(bandIndex);
  return next;
}
