import { describe, expect, it } from "vitest";

import {
  shouldEmbedToneCurveEditorInOperationPanel,
  TONE_CURVE_ACTION_ID,
} from "./tone-curve-editor-placement";

describe("shouldEmbedToneCurveEditorInOperationPanel (CT-104)", () => {
  it("embeds the editor in the Tone Curve operation panel for a raster source", () => {
    expect(
      shouldEmbedToneCurveEditorInOperationPanel({
        activeActionId: TONE_CURVE_ACTION_ID,
        sourceKind: "raster",
      }),
    ).toBe(true);
  });

  it("does not embed the editor when no operation is active (always-on histogram stays plain)", () => {
    expect(
      shouldEmbedToneCurveEditorInOperationPanel({ activeActionId: null, sourceKind: "raster" }),
    ).toBe(false);
  });

  it("does not embed the editor for a different active operation", () => {
    expect(
      shouldEmbedToneCurveEditorInOperationPanel({ activeActionId: "crop", sourceKind: "raster" }),
    ).toBe(false);
  });

  it("does not embed the editor for non-raster sources", () => {
    expect(
      shouldEmbedToneCurveEditorInOperationPanel({
        activeActionId: TONE_CURVE_ACTION_ID,
        sourceKind: "image-bitmap",
      }),
    ).toBe(false);
    expect(
      shouldEmbedToneCurveEditorInOperationPanel({
        activeActionId: TONE_CURVE_ACTION_ID,
        sourceKind: null,
      }),
    ).toBe(false);
  });
});
