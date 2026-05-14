export type BandsRowKeyboardKey = "ArrowUp" | "ArrowDown" | "Home" | "End";

export function pickNextActiveBandIndexForKey(
  key: BandsRowKeyboardKey,
  currentBandIndex: number,
  bandCount: number,
): number | null {
  if (bandCount <= 0) return null;
  const clamped = clampBandIndexToRange(currentBandIndex, bandCount);
  if (key === "ArrowUp") return clamped === 0 ? null : clamped - 1;
  if (key === "ArrowDown") return clamped === bandCount - 1 ? null : clamped + 1;
  if (key === "Home") return clamped === 0 ? null : 0;
  return clamped === bandCount - 1 ? null : bandCount - 1;
}

export function isBandsRowKeyboardKey(key: string): key is BandsRowKeyboardKey {
  return key === "ArrowUp" || key === "ArrowDown" || key === "Home" || key === "End";
}

function clampBandIndexToRange(bandIndex: number, bandCount: number): number {
  if (bandIndex < 0) return 0;
  if (bandIndex >= bandCount) return bandCount - 1;
  return bandIndex;
}
