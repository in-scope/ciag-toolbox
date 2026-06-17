// CT-180: the component-count control is the primary knob of every
// dimension-reduction transform. It defaults to the first min(10, bandCount)
// components and is always clamped to a valid 1..bandCount range so a transform
// can never be asked for more components than the cube has bands (nor fewer
// than one). resolveComponentCount is the single source of truth shared by the
// parameter field (display + clamp) and the registration descriptor (the kept
// count carried into the audit trail).

export const DEFAULT_MAX_KEPT_COMPONENTS = 10;

export function resolveComponentCount(
  requested: number | undefined,
  bandCount: number,
): number {
  const ceiling = Math.max(1, bandCount);
  if (requested === undefined || !Number.isFinite(requested)) {
    return defaultComponentCountForBandCount(ceiling);
  }
  return clampComponentCountToRange(Math.round(requested), ceiling);
}

export function defaultComponentCountForBandCount(bandCount: number): number {
  return Math.min(DEFAULT_MAX_KEPT_COMPONENTS, Math.max(1, bandCount));
}

export function formatComponentCountLabel(keptCount: number, bandCount: number): string {
  return `${keptCount} of ${bandCount}`;
}

function clampComponentCountToRange(value: number, ceiling: number): number {
  if (value < 1) return 1;
  if (value > ceiling) return ceiling;
  return value;
}
