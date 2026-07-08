// CT-220/CT-221: determinate progress for multi-unit work on the renderer thread.
// A unit is one page of a multi-page TIFF, one band of an ENVI cube, or one band of
// an operation's per-band loop; the fraction is completed units / total units. The
// yield between units lets the busy indicator paint and progress updates flush (the
// pattern documented in state/CLAUDE.md).
export type UnitProgressCallback = (fraction: number) => void;

// The leading 0 tick fires only for genuinely multi-unit work, so single-shot
// work never renders a determinate bar (it keeps the indeterminate spinner).
export function reportMultiUnitWorkStarting(
  onProgress: UnitProgressCallback | undefined,
  totalUnits: number,
): void {
  if (!onProgress || totalUnits <= 1) return;
  onProgress(0);
}

export async function reportCompletedUnitAndYieldSoProgressCanPaint(
  onProgress: UnitProgressCallback | undefined,
  completedUnits: number,
  totalUnits: number,
): Promise<void> {
  if (!onProgress) return;
  onProgress(completedUnits / Math.max(1, totalUnits));
  await yieldOnceSoTheBusyIndicatorCanPaint();
}

// CT-222: multi-phase work (e.g. brightness then contrast, normalize then invert)
// maps each phase's own 0..1 fraction into a window of the overall bar.
export function scaleProgressToWindow(
  onProgress: UnitProgressCallback | undefined,
  windowStart: number,
  windowEnd: number,
): UnitProgressCallback | undefined {
  if (!onProgress) return undefined;
  return (fraction) => onProgress(windowStart + fraction * (windowEnd - windowStart));
}

export async function computeArrayReportingPerUnitProgress<T>(
  totalUnits: number,
  computeUnit: (index: number) => T,
  onProgress: UnitProgressCallback | undefined,
): Promise<T[]> {
  reportMultiUnitWorkStarting(onProgress, totalUnits);
  const results: T[] = [];
  for (let index = 0; index < totalUnits; index += 1) {
    results.push(computeUnit(index));
    await reportCompletedUnitAndYieldSoProgressCanPaint(onProgress, index + 1, totalUnits);
  }
  return results;
}

function yieldOnceSoTheBusyIndicatorCanPaint(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
