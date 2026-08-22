import { describe, expect, it } from "vitest";

import {
  clearOperationRegionAtViewportIndex,
  clearOperationRegionFromState,
  clearOperationRegionOnViewportsLeavingSelection,
  injectOperationRegionCorners,
  listViewportIndexesLeavingSelection,
  readOperationRegionOrNull,
  requireOperationRegionForApply,
  type OperationRegionStateAccess,
} from "./operation-region";
import { DEFAULT_VIEWPORT_RENDERING_STATE, type ViewportRenderingState } from "./viewport-action";

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

describe("CT-261: the operation region never strands", () => {
  it("clears the region at one viewport, leaving its inspection ROI intact (the cancel/close path)", () => {
    const inspectionRoi = { imagePixelX0: 0, imagePixelY0: 0, imagePixelX1: 1, imagePixelY1: 1 };
    const harness = buildRenderingStateHarness(
      new Map([[0, { ...DEFAULT_VIEWPORT_RENDERING_STATE, roi: inspectionRoi, operationRegion: SAMPLE_REGION }]]),
    );
    clearOperationRegionAtViewportIndex(0, harness.stateAccess);
    expect(harness.stateAt(0).operationRegion).toBeNull();
    expect(harness.stateAt(0).roi).toEqual(inspectionRoi);
  });

  it("writes nothing when the viewport holds no region", () => {
    const harness = buildRenderingStateHarness(new Map([[0, DEFAULT_VIEWPORT_RENDERING_STATE]]));
    clearOperationRegionAtViewportIndex(0, harness.stateAccess);
    expect(harness.writes).toHaveLength(0);
  });

  it("lists exactly the viewports leaving the selection", () => {
    expect(listViewportIndexesLeavingSelection(new Set([0, 2]), new Set([2, 3]))).toEqual([0]);
    expect(listViewportIndexesLeavingSelection(new Set([1]), new Set([1]))).toEqual([]);
    expect(listViewportIndexesLeavingSelection(new Set(), new Set([4]))).toEqual([]);
  });

  it("clears the region on a panel the selection moves away from, not on the newly selected panel (the selection-change path)", () => {
    const harness = buildRenderingStateHarness(
      new Map([
        [0, { ...DEFAULT_VIEWPORT_RENDERING_STATE, operationRegion: SAMPLE_REGION }],
        [1, { ...DEFAULT_VIEWPORT_RENDERING_STATE, operationRegion: SAMPLE_REGION }],
      ]),
    );
    clearOperationRegionOnViewportsLeavingSelection(new Set([0]), new Set([1]), harness.stateAccess);
    expect(harness.stateAt(0).operationRegion).toBeNull();
    expect(harness.stateAt(1).operationRegion).toEqual(SAMPLE_REGION);
  });

  it("leaves no region on either panel after select-region, switch panel, then cancel (the crop-cancel sequence)", () => {
    const harness = buildRenderingStateHarness(
      new Map([
        [0, { ...DEFAULT_VIEWPORT_RENDERING_STATE, operationRegion: SAMPLE_REGION }],
        [1, DEFAULT_VIEWPORT_RENDERING_STATE],
      ]),
    );
    clearOperationRegionOnViewportsLeavingSelection(new Set([0]), new Set([1]), harness.stateAccess);
    clearOperationRegionAtViewportIndex(1, harness.stateAccess);
    expect(harness.stateAt(0).operationRegion).toBeNull();
    expect(harness.stateAt(1).operationRegion).toBeNull();
  });
});

interface RenderingStateHarness {
  readonly stateAccess: OperationRegionStateAccess;
  readonly stateAt: (index: number) => ViewportRenderingState;
  readonly writes: ReadonlyArray<number>;
}

function buildRenderingStateHarness(
  statesByIndex: Map<number, ViewportRenderingState>,
): RenderingStateHarness {
  const writes: number[] = [];
  return {
    stateAccess: {
      getRenderingState: (index) => statesByIndex.get(index) ?? DEFAULT_VIEWPORT_RENDERING_STATE,
      setRenderingState: (index, next) => {
        writes.push(index);
        statesByIndex.set(index, next);
      },
    },
    stateAt: (index) => statesByIndex.get(index) ?? DEFAULT_VIEWPORT_RENDERING_STATE,
    writes,
  };
}
