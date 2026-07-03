// CT-203: Butterworth transfer functions for the spatial frequency filter.
// Frequencies and cutoffs are in cycles per pixel, where 0.5 (the Nyquist
// limit) is the finest spatial detail a stack can hold.

export const BUTTERWORTH_FILTER_ORDER = 2;

export function butterworthLowpassGain(
  frequency: number,
  cutoff: number,
  order: number = BUTTERWORTH_FILTER_ORDER,
): number {
  assertCutoffIsPositive(cutoff);
  return 1 / (1 + Math.pow(frequency / cutoff, 2 * order));
}

export function butterworthHighpassGain(
  frequency: number,
  cutoff: number,
  order: number = BUTTERWORTH_FILTER_ORDER,
): number {
  assertCutoffIsPositive(cutoff);
  if (frequency === 0) return 0;
  return 1 / (1 + Math.pow(cutoff / frequency, 2 * order));
}

// The bandpass transfer is the product of a high-pass at the low cutoff and a
// low-pass at the high cutoff, so it peaks between the two.
export function butterworthBandpassGain(
  frequency: number,
  lowCutoff: number,
  highCutoff: number,
  order: number = BUTTERWORTH_FILTER_ORDER,
): number {
  assertBandpassCutoffsAreOrdered(lowCutoff, highCutoff);
  return (
    butterworthHighpassGain(frequency, lowCutoff, order) *
    butterworthLowpassGain(frequency, highCutoff, order)
  );
}

function assertCutoffIsPositive(cutoff: number): void {
  if (!Number.isFinite(cutoff) || cutoff <= 0) {
    throw new Error("Spatial filter needs a cutoff greater than 0 (cycles per pixel).");
  }
}

function assertBandpassCutoffsAreOrdered(lowCutoff: number, highCutoff: number): void {
  assertCutoffIsPositive(lowCutoff);
  assertCutoffIsPositive(highCutoff);
  if (lowCutoff >= highCutoff) {
    throw new Error("Spatial filter needs a bandpass low cutoff below the high cutoff.");
  }
}
