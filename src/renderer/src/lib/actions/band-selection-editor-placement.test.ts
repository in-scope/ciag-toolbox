import { describe, expect, it } from "vitest";

import { shouldEmbedBandSelectionEditorInOperationPanel } from "./band-selection-editor-placement";

describe("shouldEmbedBandSelectionEditorInOperationPanel", () => {
  it("embeds the editor for the band-selection action on a raster source", () => {
    expect(
      shouldEmbedBandSelectionEditorInOperationPanel({ activeActionId: "band-selection", sourceKind: "raster" }),
    ).toBe(true);
  });

  it("does not embed for a different action", () => {
    expect(
      shouldEmbedBandSelectionEditorInOperationPanel({ activeActionId: "band-weighting", sourceKind: "raster" }),
    ).toBe(false);
  });

  it("does not embed for a non-raster source", () => {
    expect(
      shouldEmbedBandSelectionEditorInOperationPanel({ activeActionId: "band-selection", sourceKind: "image-bitmap" }),
    ).toBe(false);
  });
});
