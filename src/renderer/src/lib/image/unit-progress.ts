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

// CT-223: phase-structured work (sample extraction, fit, projection) reports each
// phase boundary as an absolute fraction of the overall bar.
export async function reportProgressFractionAndYield(
  onProgress: UnitProgressCallback | undefined,
  fraction: number,
): Promise<void> {
  if (!onProgress) return;
  onProgress(fraction);
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

// CT-225: fine-grained sources (the FFT reports after every one of thousands of
// line transforms) throttle to a minimum step so a worker is not flooded with
// postMessage traffic; a fraction of exactly 1 always passes so completion is
// never swallowed. The returned callback is stateful - build one per unit of work.
export function throttleProgressToMinimumStep(
  onProgress: UnitProgressCallback | undefined,
  minimumStep: number,
): UnitProgressCallback | undefined {
  if (!onProgress) return undefined;
  let lastReportedFraction = Number.NEGATIVE_INFINITY;
  return (fraction) => {
    if (fraction < 1 && fraction - lastReportedFraction < minimumStep) return;
    lastReportedFraction = fraction;
    onProgress(fraction);
  };
}

// CT-226: chunked main-thread work (e.g. denoise rows) processes a range of
// units per chunk and yields between chunks, so the busy bar paints WITHIN a
// long unit of work instead of freezing until it completes.
export async function runInChunksReportingProgress(
  totalUnits: number,
  unitsPerChunk: number,
  processChunk: (startUnit: number, endUnit: number) => void,
  onProgress?: UnitProgressCallback,
): Promise<void> {
  const chunkSize = Math.max(1, Math.floor(unitsPerChunk));
  for (let start = 0; start < totalUnits; start += chunkSize) {
    const end = Math.min(totalUnits, start + chunkSize);
    processChunk(start, end);
    await reportCompletedUnitAndYieldSoProgressCanPaint(onProgress, end, totalUnits);
  }
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

// CT-240: exported for chunked work that must yield WITHOUT reporting progress
// (e.g. the sample-range sub-chunks inside one FastICA iteration, whose progress
// unit is the whole iteration).
export function yieldOnceSoTheBusyIndicatorCanPaint(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
