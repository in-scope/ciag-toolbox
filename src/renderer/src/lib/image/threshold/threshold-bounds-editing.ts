import type { DataTypeValueRange } from "@/lib/image/data-type-value-range";

import type { ThresholdBounds } from "./threshold";

// CT-200: the editing model for the threshold popup. Every way of moving a
// bound (histogram handle drag, numeric field, future keyboard nudge) funnels
// through these helpers so the clamps cannot diverge: bounds stay inside the
// band's value range and the lower bound never crosses above the upper.

export function buildDefaultThresholdBounds(range: DataTypeValueRange): ThresholdBounds {
  return { lower: range.min, upper: range.max };
}

export function moveLowerThresholdBoundTo(
  bounds: ThresholdBounds,
  value: number,
  range: DataTypeValueRange,
  roundForIntegerBand: boolean,
): ThresholdBounds {
  const lower = clampBoundValue(value, range.min, bounds.upper, roundForIntegerBand);
  return { lower, upper: bounds.upper };
}

export function moveUpperThresholdBoundTo(
  bounds: ThresholdBounds,
  value: number,
  range: DataTypeValueRange,
  roundForIntegerBand: boolean,
): ThresholdBounds {
  const upper = clampBoundValue(value, bounds.lower, range.max, roundForIntegerBand);
  return { lower: bounds.lower, upper };
}

export function thresholdBoundValueAtFraction(range: DataTypeValueRange, fraction: number): number {
  return range.min + clampToUnitInterval(fraction) * (range.max - range.min);
}

export function fractionForThresholdBoundValue(range: DataTypeValueRange, value: number): number {
  const span = range.max - range.min;
  if (span <= 0) return 0;
  return clampToUnitInterval((value - range.min) / span);
}

function clampBoundValue(
  value: number,
  min: number,
  max: number,
  roundForIntegerBand: boolean,
): number {
  const rounded = roundForIntegerBand ? Math.round(value) : value;
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

function clampToUnitInterval(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
