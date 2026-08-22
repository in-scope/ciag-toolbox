import { describe, expect, it } from "vitest";

import { NO_PARAMETER_VALUES } from "./parameter-schema";
import {
  OTSU_THRESHOLD_METHOD,
  MANUAL_THRESHOLD_METHOD,
  THRESHOLD_ACTION_ID,
  THRESHOLD_METHOD_PARAMETER_ID,
} from "./threshold-action";
import { shouldEmbedThresholdEditorInOperationPanel } from "./threshold-editor-placement";

describe("shouldEmbedThresholdEditorInOperationPanel (CT-200/CT-282)", () => {
  it("embeds the editor in the Threshold operation panel for a raster source", () => {
    expect(
      shouldEmbedThresholdEditorInOperationPanel({
        activeActionId: THRESHOLD_ACTION_ID,
        sourceKind: "raster",
        activeParameterValues: NO_PARAMETER_VALUES,
      }),
    ).toBe(true);
  });

  it("embeds the editor when the Manual method is explicitly selected", () => {
    expect(
      shouldEmbedThresholdEditorInOperationPanel({
        activeActionId: THRESHOLD_ACTION_ID,
        sourceKind: "raster",
        activeParameterValues: { [THRESHOLD_METHOD_PARAMETER_ID]: MANUAL_THRESHOLD_METHOD },
      }),
    ).toBe(true);
  });

  it("hides the editor when the Otsu method is selected", () => {
    expect(
      shouldEmbedThresholdEditorInOperationPanel({
        activeActionId: THRESHOLD_ACTION_ID,
        sourceKind: "raster",
        activeParameterValues: { [THRESHOLD_METHOD_PARAMETER_ID]: OTSU_THRESHOLD_METHOD },
      }),
    ).toBe(false);
  });

  it("does not embed the editor when no operation is active", () => {
    expect(
      shouldEmbedThresholdEditorInOperationPanel({
        activeActionId: null,
        sourceKind: "raster",
        activeParameterValues: NO_PARAMETER_VALUES,
      }),
    ).toBe(false);
  });

  it("does not embed the editor for a different active operation", () => {
    expect(
      shouldEmbedThresholdEditorInOperationPanel({
        activeActionId: "tone-curve",
        sourceKind: "raster",
        activeParameterValues: NO_PARAMETER_VALUES,
      }),
    ).toBe(false);
  });

  it("does not embed the editor for non-raster sources", () => {
    expect(
      shouldEmbedThresholdEditorInOperationPanel({
        activeActionId: THRESHOLD_ACTION_ID,
        sourceKind: "image-bitmap",
        activeParameterValues: NO_PARAMETER_VALUES,
      }),
    ).toBe(false);
  });
});
