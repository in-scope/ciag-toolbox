import { describe, expect, it } from "vitest";

import type { ToneCurveAnchor } from "@/lib/image/apply-tone-curve";
import {
  applyToneCurveAnchorKeyboardAction,
  isToneCurveEditorKey,
} from "@/lib/image/tone-curve-anchor-keyboard";
import type { ToneCurveValueRanges } from "@/lib/image/tone-curve-editor-state";

const UINT16_RANGES: ToneCurveValueRanges = { inputMin: 0, inputMax: 65535, outputMin: 0, outputMax: 65535 };
const STEP = 1;

function threeAnchors(): ReadonlyArray<ToneCurveAnchor> {
  return [
    { input: 0, output: 0 },
    { input: 30000, output: 30000 },
    { input: 65535, output: 65535 },
  ];
}

describe("isToneCurveEditorKey", () => {
  it("recognises the arrow and delete keys", () => {
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Delete", "Backspace"]) {
      expect(isToneCurveEditorKey(key)).toBe(true);
    }
  });

  it("ignores unrelated keys", () => {
    expect(isToneCurveEditorKey("Enter")).toBe(false);
    expect(isToneCurveEditorKey("a")).toBe(false);
  });
});

describe("applyToneCurveAnchorKeyboardAction nudging", () => {
  it("ArrowRight moves an interior anchor's input up by one step", () => {
    const result = applyToneCurveAnchorKeyboardAction("ArrowRight", threeAnchors(), 1, UINT16_RANGES, STEP);
    expect(result.anchors[1]!.input).toBe(30001);
    expect(result.selectedAnchorIndex).toBe(1);
  });

  it("ArrowLeft moves an interior anchor's input down by one step", () => {
    const result = applyToneCurveAnchorKeyboardAction("ArrowLeft", threeAnchors(), 1, UINT16_RANGES, STEP);
    expect(result.anchors[1]!.input).toBe(29999);
  });

  it("ArrowUp moves the selected anchor's output up by one step", () => {
    const result = applyToneCurveAnchorKeyboardAction("ArrowUp", threeAnchors(), 1, UINT16_RANGES, STEP);
    expect(result.anchors[1]!.output).toBe(30001);
  });

  it("ArrowDown moves the selected anchor's output down by one step", () => {
    const result = applyToneCurveAnchorKeyboardAction("ArrowDown", threeAnchors(), 1, UINT16_RANGES, STEP);
    expect(result.anchors[1]!.output).toBe(29999);
  });

  it("keeps an endpoint's input fixed on a horizontal nudge", () => {
    const anchors = threeAnchors();
    const result = applyToneCurveAnchorKeyboardAction("ArrowRight", anchors, 0, UINT16_RANGES, STEP);
    expect(result.anchors).toBe(anchors);
    expect(result.anchors[0]!.input).toBe(0);
  });

  it("still nudges an endpoint's output vertically", () => {
    const result = applyToneCurveAnchorKeyboardAction("ArrowDown", threeAnchors(), 2, UINT16_RANGES, STEP);
    expect(result.anchors[2]!.output).toBe(65534);
  });

  it("clamps an interior anchor's input below its right neighbour", () => {
    const anchors: ReadonlyArray<ToneCurveAnchor> = [
      { input: 0, output: 0 },
      { input: 65534, output: 30000 },
      { input: 65535, output: 65535 },
    ];
    const result = applyToneCurveAnchorKeyboardAction("ArrowRight", anchors, 1, UINT16_RANGES, STEP);
    expect(result.anchors[1]!.input).toBeLessThan(result.anchors[2]!.input);
  });
});

describe("applyToneCurveAnchorKeyboardAction delete", () => {
  it("removes the selected interior anchor and selects its left neighbour", () => {
    const result = applyToneCurveAnchorKeyboardAction("Delete", threeAnchors(), 1, UINT16_RANGES, STEP);
    expect(result.anchors).toHaveLength(2);
    expect(result.selectedAnchorIndex).toBe(0);
  });

  it("treats Backspace the same as Delete", () => {
    const result = applyToneCurveAnchorKeyboardAction("Backspace", threeAnchors(), 1, UINT16_RANGES, STEP);
    expect(result.anchors).toHaveLength(2);
  });

  it("is a no-op when an endpoint is selected", () => {
    const anchors = threeAnchors();
    const result = applyToneCurveAnchorKeyboardAction("Delete", anchors, 0, UINT16_RANGES, STEP);
    expect(result.anchors).toBe(anchors);
    expect(result.selectedAnchorIndex).toBe(0);
  });
});
