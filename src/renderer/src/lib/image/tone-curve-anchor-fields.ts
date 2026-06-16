import type { ToneCurveAnchor } from "@/lib/image/apply-tone-curve";
import {
  moveToneCurveAnchor,
  type ToneCurveValueRanges,
} from "@/lib/image/tone-curve-editor-state";

/**
 * Pure model for the CT-165 numeric Input/Output fields of the selected tone-curve
 * anchor. Numeric edits MUST clamp exactly like a drag, so the move helpers below
 * funnel through the same `moveToneCurveAnchor` as the drag path: the endpoints stay
 * fixed in Input, interior anchors cannot cross their neighbours, and Output is
 * clamped to the band's output range. Formatting/stepping pick an integer step (1)
 * or a small float step from the active band's data type.
 */
const FLOAT_FIELD_STEP = 0.01;
const FLOAT_FIELD_FRACTION_DIGITS = 4;

export function toneCurveFieldStepForBand(isIntegerBand: boolean): number {
  return isIntegerBand ? 1 : FLOAT_FIELD_STEP;
}

export function isToneCurveEndpointIndex(index: number, anchorCount: number): boolean {
  return index <= 0 || index >= anchorCount - 1;
}

export function formatToneCurveFieldValue(value: number, isIntegerBand: boolean): string {
  if (isIntegerBand) return String(Math.round(value));
  return String(Number(value.toFixed(FLOAT_FIELD_FRACTION_DIGITS)));
}

export function parseToneCurveFieldValueOrNull(text: string): number | null {
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value : null;
}

export function moveSelectedAnchorInputTo(
  anchors: ReadonlyArray<ToneCurveAnchor>,
  index: number,
  input: number,
  ranges: ToneCurveValueRanges,
): ReadonlyArray<ToneCurveAnchor> {
  const anchor = anchors[index];
  if (!anchor) return anchors;
  return moveToneCurveAnchor(anchors, index, { input, output: anchor.output }, ranges);
}

export function moveSelectedAnchorOutputTo(
  anchors: ReadonlyArray<ToneCurveAnchor>,
  index: number,
  output: number,
  ranges: ToneCurveValueRanges,
): ReadonlyArray<ToneCurveAnchor> {
  const anchor = anchors[index];
  if (!anchor) return anchors;
  return moveToneCurveAnchor(anchors, index, { input: anchor.input, output }, ranges);
}
