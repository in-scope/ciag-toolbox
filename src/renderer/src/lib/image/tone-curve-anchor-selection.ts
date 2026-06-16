/**
 * Pure selection model for the interactive tone-curve editor (CT-164). Exactly
 * ONE anchor is selected at a time so the numeric Input/Output fields (CT-165)
 * and keyboard nudge/delete actions (CT-166) always have a single target. The
 * selected anchor is identified by its index in the sorted anchor array; this
 * module keeps that index valid as anchors are added, removed, or reset. The
 * default selection is the left endpoint (index 0), which is also what mount and
 * a reset-to-default fall back to.
 */
export const DEFAULT_SELECTED_TONE_CURVE_ANCHOR_INDEX = 0;

export function clampSelectedToneCurveAnchorIndex(index: number, anchorCount: number): number {
  if (!Number.isInteger(index)) return DEFAULT_SELECTED_TONE_CURVE_ANCHOR_INDEX;
  if (index < 0 || index >= anchorCount) return DEFAULT_SELECTED_TONE_CURVE_ANCHOR_INDEX;
  return index;
}
