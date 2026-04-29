export function computeInitialPickerTargetsFromSelection(
  selectedIndices: ReadonlySet<number>,
  cellCount: number,
): ReadonlySet<number> {
  if (selectedIndices.size === 0) return EMPTY_TARGET_SET;
  return keepIndicesWithinCellCount(selectedIndices, cellCount);
}

export function makeAllViewportsPickerTargets(cellCount: number): ReadonlySet<number> {
  const all = new Set<number>();
  for (let index = 0; index < cellCount; index++) all.add(index);
  return all;
}

export function togglePickerTargetAtIndex(
  targets: ReadonlySet<number>,
  index: number,
): ReadonlySet<number> {
  const next = new Set(targets);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  return next;
}

const EMPTY_TARGET_SET: ReadonlySet<number> = new Set();

function keepIndicesWithinCellCount(
  source: ReadonlySet<number>,
  cellCount: number,
): ReadonlySet<number> {
  const filtered = new Set<number>();
  for (const index of source) {
    if (index >= 0 && index < cellCount) filtered.add(index);
  }
  return filtered;
}
