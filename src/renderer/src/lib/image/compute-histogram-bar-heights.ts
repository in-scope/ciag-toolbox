export interface HistogramBarHeightInputs {
  readonly bins: Uint32Array;
  readonly heightPx: number;
}

export function computeHistogramBarHeightsInPixels(
  inputs: HistogramBarHeightInputs,
): ReadonlyArray<number> {
  const peakCount = findHistogramPeakBinCount(inputs.bins);
  if (peakCount === 0) return buildZeroBarHeights(inputs.bins.length);
  return buildBarHeightsScaledToPeak(inputs.bins, inputs.heightPx, peakCount);
}

function findHistogramPeakBinCount(bins: Uint32Array): number {
  let peak = 0;
  for (let i = 0; i < bins.length; i++) {
    const value = bins[i] ?? 0;
    if (value > peak) peak = value;
  }
  return peak;
}

function buildZeroBarHeights(barCount: number): ReadonlyArray<number> {
  const heights = new Array<number>(barCount);
  for (let i = 0; i < barCount; i++) heights[i] = 0;
  return heights;
}

function buildBarHeightsScaledToPeak(
  bins: Uint32Array,
  heightPx: number,
  peakCount: number,
): ReadonlyArray<number> {
  const heights = new Array<number>(bins.length);
  for (let i = 0; i < bins.length; i++) {
    const value = bins[i] ?? 0;
    heights[i] = (value / peakCount) * heightPx;
  }
  return heights;
}
