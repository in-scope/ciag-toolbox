export function clampBandIndexWithinCount(bandIndex: number, bandCount: number): number {
  if (bandCount <= 0) return 0;
  if (bandIndex < 0) return 0;
  if (bandIndex >= bandCount) return bandCount - 1;
  return Math.floor(bandIndex);
}

export function stepBandIndexInDirection(
  currentBandIndex: number,
  direction: number,
  bandCount: number,
): number {
  const stepSign = direction < 0 ? -1 : 1;
  return clampBandIndexWithinCount(currentBandIndex + stepSign, bandCount);
}

export function parseTypedBandNumberToIndexOrNull(
  text: string,
  bandCount: number,
): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const oneBasedNumber = Number.parseInt(trimmed, 10);
  if (oneBasedNumber < 1 || oneBasedNumber > bandCount) return null;
  return oneBasedNumber - 1;
}

export function formatBandNumberForInput(bandIndex: number): string {
  return String(bandIndex + 1);
}

export function pickBandStepDirectionFromWheelDelta(deltaY: number): number {
  return deltaY > 0 ? 1 : -1;
}
