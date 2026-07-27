import { describe, expect, it } from "vitest";

import { shouldEmbedBandWeightingEditorInOperationPanel } from "./band-weighting-editor-placement";

describe("shouldEmbedBandWeightingEditorInOperationPanel", () => {
  it("embeds the editor for the band-weighting action on a raster source", () => {
    expect(
      shouldEmbedBandWeightingEditorInOperationPanel({ activeActionId: "band-weighting", sourceKind: "raster" }),
    ).toBe(true);
  });

  it("does not embed for a different action", () => {
    expect(
      shouldEmbedBandWeightingEditorInOperationPanel({ activeActionId: "threshold", sourceKind: "raster" }),
    ).toBe(false);
  });

  it("does not embed for a non-raster source", () => {
    expect(
      shouldEmbedBandWeightingEditorInOperationPanel({ activeActionId: "band-weighting", sourceKind: "image-bitmap" }),
    ).toBe(false);
  });
});
