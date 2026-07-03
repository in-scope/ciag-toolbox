import type { BandHistogram } from "@/lib/image/compute-band-histogram";

import type { ThresholdBounds } from "./threshold";

// CT-201: Otsu's method over an already-binned band histogram. The best split
// maximizes the between-class variance w0 * w1 * (mean0 - mean1)^2; bin indices
// stand in for values (equal-width bins make the argmax identical). Ties keep
// the FIRST maximizing split, so an empty valley between two clusters yields
// the lowest cutoff just above the darker cluster, deterministically. The
// returned cutoff is the lower edge of the first foreground bin, so the Otsu
// bounds [cutoff, histogram.max] classify every foreground bin as white.

export function computeOtsuThreshold(histogram: BandHistogram): number {
  const bestSplit = findBestOtsuSplitBinIndex(histogram.bins);
  if (bestSplit === null) return midpointOfHistogramRange(histogram);
  return histogram.min + (bestSplit + 1) * histogram.binWidth;
}

export function computeOtsuBoundsForHistogram(histogram: BandHistogram): ThresholdBounds {
  return { lower: computeOtsuThreshold(histogram), upper: histogram.max };
}

interface BinTotals {
  readonly count: number;
  readonly indexWeightedSum: number;
}

// Returns null when no split separates two non-empty classes (an empty
// histogram or one with a single populated bin); the caller falls back to the
// range midpoint as the documented degenerate-histogram cutoff.
function findBestOtsuSplitBinIndex(bins: Uint32Array): number | null {
  const totals = sumBinCountsAndIndexWeightedSum(bins);
  let bestSplit: number | null = null;
  let bestVariance = 0;
  let count0 = 0;
  let indexWeightedSum0 = 0;
  for (let split = 0; split < bins.length - 1; split += 1) {
    count0 += bins[split] ?? 0;
    indexWeightedSum0 += split * (bins[split] ?? 0);
    const variance = betweenClassVarianceForSplit(count0, indexWeightedSum0, totals);
    if (variance > bestVariance) {
      bestVariance = variance;
      bestSplit = split;
    }
  }
  return bestSplit;
}

function betweenClassVarianceForSplit(
  count0: number,
  indexWeightedSum0: number,
  totals: BinTotals,
): number {
  const count1 = totals.count - count0;
  if (count0 === 0 || count1 === 0) return 0;
  const meanDifference =
    indexWeightedSum0 / count0 - (totals.indexWeightedSum - indexWeightedSum0) / count1;
  return count0 * count1 * meanDifference * meanDifference;
}

function sumBinCountsAndIndexWeightedSum(bins: Uint32Array): BinTotals {
  let count = 0;
  let indexWeightedSum = 0;
  for (let binIndex = 0; binIndex < bins.length; binIndex += 1) {
    count += bins[binIndex] ?? 0;
    indexWeightedSum += binIndex * (bins[binIndex] ?? 0);
  }
  return { count, indexWeightedSum };
}

function midpointOfHistogramRange(histogram: BandHistogram): number {
  return histogram.min + (histogram.max - histogram.min) / 2;
}
