export function findLowestIndexEmptyViewport<TContent>(
  imagesByIndex: ReadonlyMap<number, TContent>,
  cellCount: number,
): number | null {
  for (let index = 0; index < cellCount; index++) {
    if (!imagesByIndex.has(index)) return index;
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
