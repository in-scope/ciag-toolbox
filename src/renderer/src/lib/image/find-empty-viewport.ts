// CT-269: excludedIndexes are cells that LOOK empty but are already reserved
// as the result target of an in-flight apply; they must never be handed out.
export function findLowestIndexEmptyViewport<TContent>(
  imagesByIndex: ReadonlyMap<number, TContent>,
  cellCount: number,
  excludedIndexes?: ReadonlySet<number>,
): number | null {
  for (let index = 0; index < cellCount; index++) {
    if (imagesByIndex.has(index)) continue;
    if (excludedIndexes?.has(index)) continue;
    return index;
  }
  return null;
}

export function listOccupiedViewportEntries<TContent>(
  imagesByIndex: ReadonlyMap<number, TContent>,
  cellCount: number,
  toFileName: (content: TContent) => string,
): ReadonlyArray<{ index: number; fileName: string }> {
  const entries: { index: number; fileName: string }[] = [];
  for (let index = 0; index < cellCount; index++) {
    const content = imagesByIndex.get(index);
    if (content) entries.push({ index, fileName: toFileName(content) });
  }
  return entries;
}
