import { formatSinglePixelReadoutValue } from "@/lib/image/compute-pixel-readout";
import {
  formatHistogramPixelCountForAxis,
  formatNumberStringWithSuperscriptExponent,
} from "@/lib/image/format-axis-number";
import type { RasterSampleFormat } from "@/lib/image/raster-image";

export const ESTIMATED_TICK_CHARACTER_WIDTH_PX = 7;
const MINIMUM_TICK_LABEL_CLEARANCE_PX = 8;

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
  axisWidthPx: number,
): ReadonlyArray<HistogramAxisTickLabel> {
  const minTick = buildTickLabel(range.min, 0, "start", sampleFormat);
  const maxTick = buildTickLabel(range.max, 1, "end", sampleFormat);
  const zeroTick = buildZeroTickWhenItClearsTheEdgeLabelsOrNull(
    range,
    sampleFormat,
    axisWidthPx,
    minTick,
    maxTick,
  );
  return zeroTick ? [minTick, zeroTick, maxTick] : [minTick, maxTick];
}

function buildZeroTickWhenItClearsTheEdgeLabelsOrNull(
  range: HistogramAxisRange,
  sampleFormat: RasterSampleFormat,
  axisWidthPx: number,
  minTick: HistogramAxisTickLabel,
  maxTick: HistogramAxisTickLabel,
): HistogramAxisTickLabel | null {
  if (!doesRangeSpanZero(range)) return null;
  const fraction = computeZeroFractionAcrossRange(range);
  const zeroTick = buildTickLabel(0, fraction, "middle", sampleFormat);
  if (!doesZeroLabelClearBothEdgeLabels(zeroTick, minTick, maxTick, axisWidthPx)) return null;
  return zeroTick;
}

function doesZeroLabelClearBothEdgeLabels(
  zeroTick: HistogramAxisTickLabel,
  minTick: HistogramAxisTickLabel,
  maxTick: HistogramAxisTickLabel,
  axisWidthPx: number,
): boolean {
  const zeroCenterPx = zeroTick.fraction * axisWidthPx;
  const halfZeroSpanPx = estimateTickLabelSpanPx(zeroTick.text) / 2;
  const gapToMinLabelPx = zeroCenterPx - halfZeroSpanPx - estimateTickLabelSpanPx(minTick.text);
  const maxLabelLeftEdgePx = axisWidthPx - estimateTickLabelSpanPx(maxTick.text);
  const gapToMaxLabelPx = maxLabelLeftEdgePx - (zeroCenterPx + halfZeroSpanPx);
  return (
    gapToMinLabelPx >= MINIMUM_TICK_LABEL_CLEARANCE_PX &&
    gapToMaxLabelPx >= MINIMUM_TICK_LABEL_CLEARANCE_PX
  );
}

function estimateTickLabelSpanPx(text: string): number {
  return text.length * ESTIMATED_TICK_CHARACTER_WIDTH_PX;
}

function doesRangeSpanZero(range: HistogramAxisRange): boolean {
  return range.min < 0 && range.max > 0;
}

function computeZeroFractionAcrossRange(range: HistogramAxisRange): number {
  return (0 - range.min) / (range.max - range.min);
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
