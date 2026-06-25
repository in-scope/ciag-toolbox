import type { ToneCurveAnchor } from "@/lib/image/apply-tone-curve";
import {
  isToneCurveEndpointIndex,
  moveSelectedAnchorInputTo,
  moveSelectedAnchorOutputTo,
} from "@/lib/image/tone-curve-anchor-fields";
import {
  isRemovableInteriorAnchorIndex,
  removeToneCurveAnchor,
  type ToneCurveValueRanges,
} from "@/lib/image/tone-curve-editor-state";

/**
 * Pure keyboard model for the CT-166 nudge/delete actions on the selected
 * tone-curve anchor. Arrow keys move the selected anchor by one data-type step,
 * funnelling through the SAME move helpers as the drag and numeric-field paths so
 * the clamping can never diverge: an endpoint Input nudges inward between the
 * data-range edge and its neighbour (CT-199 black/white point), interior anchors
 * cannot cross their neighbours, and Output is clamped to the band's output range.
 * Delete/Backspace removes the selected interior
 * anchor and selects its left neighbour; on an endpoint it is a no-op. The result
 * always returns the (possibly unchanged) anchors plus the next selected index so
 * the caller can apply both atomically.
 */
const TONE_CURVE_EDITOR_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Delete",
  "Backspace",
]);

export interface ToneCurveAnchorKeyboardResult {
  readonly anchors: ReadonlyArray<ToneCurveAnchor>;
  readonly selectedAnchorIndex: number;
}

export function isToneCurveEditorKey(key: string): boolean {
  return TONE_CURVE_EDITOR_KEYS.has(key);
}

export function applyToneCurveAnchorKeyboardAction(
  key: string,
  anchors: ReadonlyArray<ToneCurveAnchor>,
  index: number,
  ranges: ToneCurveValueRanges,
  step: number,
): ToneCurveAnchorKeyboardResult {
  if (isAnchorDeleteKey(key)) return deleteSelectedInteriorAnchor(anchors, index);
  return { anchors: nudgeSelectedAnchor(key, anchors, index, ranges, step), selectedAnchorIndex: index };
}

function isAnchorDeleteKey(key: string): boolean {
  return key === "Delete" || key === "Backspace";
}

function deleteSelectedInteriorAnchor(
  anchors: ReadonlyArray<ToneCurveAnchor>,
  index: number,
): ToneCurveAnchorKeyboardResult {
  if (!isRemovableInteriorAnchorIndex(anchors, index)) return { anchors, selectedAnchorIndex: index };
  return { anchors: removeToneCurveAnchor(anchors, index), selectedAnchorIndex: index - 1 };
}

function nudgeSelectedAnchor(
  key: string,
  anchors: ReadonlyArray<ToneCurveAnchor>,
  index: number,
  ranges: ToneCurveValueRanges,
  step: number,
): ReadonlyArray<ToneCurveAnchor> {
  const anchor = anchors[index];
  if (!anchor) return anchors;
  if (key === "ArrowLeft" || key === "ArrowRight") return nudgeSelectedAnchorInput(key, anchors, index, ranges, step);
  if (key === "ArrowUp" || key === "ArrowDown") return nudgeSelectedAnchorOutput(key, anchors, index, ranges, step);
  return anchors;
}

function nudgeSelectedAnchorInput(
  key: string,
  anchors: ReadonlyArray<ToneCurveAnchor>,
  index: number,
  ranges: ToneCurveValueRanges,
  step: number,
): ReadonlyArray<ToneCurveAnchor> {
  if (isToneCurveEndpointIndex(index, anchors.length)) return anchors;
  const delta = key === "ArrowRight" ? step : -step;
  return moveSelectedAnchorInputTo(anchors, index, anchors[index]!.input + delta, ranges);
}

function nudgeSelectedAnchorOutput(
  key: string,
  anchors: ReadonlyArray<ToneCurveAnchor>,
  index: number,
  ranges: ToneCurveValueRanges,
  step: number,
): ReadonlyArray<ToneCurveAnchor> {
  const delta = key === "ArrowUp" ? step : -step;
  return moveSelectedAnchorOutputTo(anchors, index, anchors[index]!.output + delta, ranges);
}
