import { describe, expect, it } from "vitest";

import { shouldEmbedCustomTransformEditorInOperationPanel } from "./custom-transform-editor-placement";

describe("shouldEmbedCustomTransformEditorInOperationPanel", () => {
  it("embeds the editor for the custom-transform action on a raster source", () => {
    expect(
      shouldEmbedCustomTransformEditorInOperationPanel({ activeActionId: "custom-transform", sourceKind: "raster" }),
    ).toBe(true);
  });

  it("does not embed for a different action", () => {
    expect(
      shouldEmbedCustomTransformEditorInOperationPanel({ activeActionId: "band-selection", sourceKind: "raster" }),
    ).toBe(false);
  });

  it("does not embed for a non-raster source", () => {
    expect(
      shouldEmbedCustomTransformEditorInOperationPanel({ activeActionId: "custom-transform", sourceKind: "image-bitmap" }),
    ).toBe(false);
  });
});
