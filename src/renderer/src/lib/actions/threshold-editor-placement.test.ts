import { describe, expect, it } from "vitest";

import { THRESHOLD_ACTION_ID } from "./threshold-action";
import { shouldEmbedThresholdEditorInOperationPanel } from "./threshold-editor-placement";

describe("shouldEmbedThresholdEditorInOperationPanel (CT-200)", () => {
  it("embeds the editor in the Threshold operation panel for a raster source", () => {
    expect(
      shouldEmbedThresholdEditorInOperationPanel({
        activeActionId: THRESHOLD_ACTION_ID,
        sourceKind: "raster",
      }),
    ).toBe(true);
  });

  it("does not embed the editor when no operation is active", () => {
    expect(
      shouldEmbedThresholdEditorInOperationPanel({ activeActionId: null, sourceKind: "raster" }),
    ).toBe(false);
  });

  it("does not embed the editor for a different active operation", () => {
    expect(
      shouldEmbedThresholdEditorInOperationPanel({
        activeActionId: "tone-curve",
        sourceKind: "raster",
      }),
    ).toBe(false);
  });

  it("does not embed the editor for non-raster sources", () => {
    expect(
      shouldEmbedThresholdEditorInOperationPanel({
        activeActionId: THRESHOLD_ACTION_ID,
        sourceKind: "image-bitmap",
      }),
    ).toBe(false);
  });
});
