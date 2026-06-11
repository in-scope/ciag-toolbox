import { formatSinglePixelReadoutValue } from "@/lib/image/compute-pixel-readout";
import {
  formatHistogramPixelCountForAxis,
  formatNumberStringWithSuperscriptExponent,
} from "@/lib/image/format-axis-number";
import type { RasterSampleFormat } from "@/lib/image/raster-image";

const MINIMUM_FRACTION_GAP_TO_SHOW_ZERO_TICK = 0.12;

export type HistogramAxisTickAnchor = "start" | "middle" | "end";

export interface HistogramAxisTickLabel {
  readonly value: number;
  readonly text: string;
  readonly fraction: number;
  readonly anchor: HistogramAxisTickAnchor;
}

export interface HistogramAxisRange {
  readonly min: number;
  readonly max: number;
}

export function computeHistogramAxisTickLabels(
  range: HistogramAxisRange,
  sampleFormat: RasterSampleFormat,
): ReadonlyArray<HistogramAxisTickLabel> {
  const ticks = [
    buildTickLabel(range.min, 0, "start", sampleFormat),
    buildTickLabel(range.max, 1, "end", sampleFormat),
  ];
  const zeroTick = buildZeroTickWhenRangeSpansZeroOrNull(range, sampleFormat);
  if (zeroTick) ticks.splice(1, 0, zeroTick);
  return ticks;
}

function buildZeroTickWhenRangeSpansZeroOrNull(
  range: HistogramAxisRange,
  sampleFormat: RasterSampleFormat,
): HistogramAxisTickLabel | null {
  if (!doesRangeSpanZero(range)) return null;
  const fraction = computeZeroFractionAcrossRange(range);
  if (isFractionTooCloseToAnEdge(fraction)) return null;
  return buildTickLabel(0, fraction, "middle", sampleFormat);
}

function doesRangeSpanZero(range: HistogramAxisRange): boolean {
  return range.min < 0 && range.max > 0;
}

function computeZeroFractionAcrossRange(range: HistogramAxisRange): number {
  return (0 - range.min) / (range.max - range.min);
}

function isFractionTooCloseToAnEdge(fraction: number): boolean {
  if (fraction < MINIMUM_FRACTION_GAP_TO_SHOW_ZERO_TICK) return true;
  return fraction > 1 - MINIMUM_FRACTION_GAP_TO_SHOW_ZERO_TICK;
}

function buildTickLabel(
  value: number,
  fraction: number,
  anchor: HistogramAxisTickAnchor,
  sampleFormat: RasterSampleFormat,
): HistogramAxisTickLabel {
  return {
    value,
    text: formatNumberStringWithSuperscriptExponent(
      formatSinglePixelReadoutValue(value, sampleFormat),
    ),
    fraction,
    anchor,
  };
}

export interface HistogramCountAxisTickLabel {
  readonly count: number;
  readonly text: string;
  readonly fraction: number;
}

export function computeHistogramCountAxisTickLabels(
  bins: ArrayLike<number>,
): ReadonlyArray<HistogramCountAxisTickLabel> {
  const peakCount = findHistogramPeakBinCount(bins);
  if (peakCount <= 0) return [buildCountTickLabel(0, 0)];
  return [buildCountTickLabel(peakCount, 1), buildCountTickLabel(0, 0)];
}

function buildCountTickLabel(count: number, fraction: number): HistogramCountAxisTickLabel {
  return { count, text: formatHistogramPixelCountForAxis(count), fraction };
}

function findHistogramPeakBinCount(bins: ArrayLike<number>): number {
  let peak = 0;
  for (let index = 0; index < bins.length; index++) {
    const value = bins[index] ?? 0;
    if (value > peak) peak = value;
  }
  return peak;
}
