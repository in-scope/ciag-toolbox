import type { SliderParameterSchema } from "@/lib/actions/parameter-schema";

// CT-257: a log-symmetric slider runs its Radix track over POSITIONS 0..1 and
// maps position p to maxValue^(2p - 1): the minimum is 1 / maxValue, the exact
// center is 1, and one position step is one constant RATIO step, so fine
// control near 1 coexists with a genuinely distorting reach at the ends.
// Committed values snap to two decimals so the displayed number, the History
// label (toFixed(2)), and the applied ratio are the same value. The
// Brightness & Contrast contrast slider (0.05..20) is the first user.

export function sliderPositionToLogSymmetricValue(position: number, maximumValue: number): number {
  return Math.pow(maximumValue, 2 * position - 1);
}

export function logSymmetricValueToSliderPosition(value: number, maximumValue: number): number {
  return (Math.log(value) / Math.log(maximumValue) + 1) / 2;
}

export interface SliderTrackMapping {
  readonly trackMin: number;
  readonly trackMax: number;
  readonly trackStep: number;
  readonly thumbPosition: number;
  readonly valueAtThumbPosition: (thumbPosition: number) => number;
}

export function describeSliderTrackForSchema(
  schema: SliderParameterSchema,
  value: number,
): SliderTrackMapping {
  if (schema.scale !== "log-symmetric") return describeLinearSliderTrack(schema, value);
  return {
    trackMin: 0,
    trackMax: 1,
    trackStep: schema.step,
    thumbPosition: logSymmetricValueToSliderPosition(value, schema.max),
    valueAtThumbPosition: (thumbPosition) =>
      roundToTwoDecimals(sliderPositionToLogSymmetricValue(thumbPosition, schema.max)),
  };
}

function describeLinearSliderTrack(schema: SliderParameterSchema, value: number): SliderTrackMapping {
  return {
    trackMin: schema.min,
    trackMax: schema.max,
    trackStep: schema.step,
    thumbPosition: value,
    valueAtThumbPosition: (thumbPosition) => thumbPosition,
  };
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}
