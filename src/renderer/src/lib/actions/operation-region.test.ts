import { describe, expect, it } from "vitest";

import {
  clearOperationRegionFromState,
  injectOperationRegionCorners,
  readOperationRegionOrNull,
  requireOperationRegionForApply,
} from "./operation-region";
import { DEFAULT_VIEWPORT_RENDERING_STATE } from "./viewport-action";

const CORNER_IDS = { x0: "x0", y0: "y0", x1: "x1", y1: "y1" } as const;
const SAMPLE_REGION = { imagePixelX0: 3, imagePixelY0: 4, imagePixelX1: 9, imagePixelY1: 12 };

describe("the shared per-operation region-request path", () => {
  it("reads the per-operation region from rendering state, not the inspection ROI", () => {
    const inspectionRoi = { imagePixelX0: 0, imagePixelY0: 0, imagePixelX1: 1, imagePixelY1: 1 };
    const state = { ...DEFAULT_VIEWPORT_RENDERING_STATE, roi: inspectionRoi, operationRegion: SAMPLE_REGION };
    expect(readOperationRegionOrNull(state)).toEqual(SAMPLE_REGION);
  });

  it("requires the operation region, ignoring any stale inspection ROI", () => {
    const inspectionRoi = { imagePixelX0: 0, imagePixelY0: 0, imagePixelX1: 1, imagePixelY1: 1 };
    const staleState = { ...DEFAULT_VIEWPORT_RENDERING_STATE, roi: inspectionRoi, operationRegion: null };
    expect(() => requireOperationRegionForApply(staleState, "Crop")).toThrow(/needs a region/);
  });

  it("returns the operation region when one has been selected for the operation", () => {
    const state = { ...DEFAULT_VIEWPORT_RENDERING_STATE, operationRegion: SAMPLE_REGION };
    expect(requireOperationRegionForApply(state, "Crop")).toEqual(SAMPLE_REGION);
  });

  it("injects the region corners under the operation's own parameter ids", () => {
    const injected = injectOperationRegionCorners({ existing: 1 }, SAMPLE_REGION, CORNER_IDS);
    expect(injected).toEqual({ existing: 1, x0: 3, y0: 4, x1: 9, y1: 12 });
  });

  it("clears the per-operation region without touching the inspection ROI", () => {
    const inspectionRoi = { imagePixelX0: 0, imagePixelY0: 0, imagePixelX1: 1, imagePixelY1: 1 };
    const state = { ...DEFAULT_VIEWPORT_RENDERING_STATE, roi: inspectionRoi, operationRegion: SAMPLE_REGION };
    const cleared = clearOperationRegionFromState(state);
    expect(cleared.operationRegion).toBeNull();
    expect(cleared.roi).toEqual(inspectionRoi);
  });
});
