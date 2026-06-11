import type { ViewportRoi } from "@/lib/image/viewport-roi";

import type { ParameterValuesById } from "./parameter-schema";
import type { ViewportRenderingState } from "./viewport-action";

/**
 * The shared per-operation region-request path (CT-095). Operations that need an
 * area of the image obtain it from the per-operation `operationRegion` the user
 * selects as part of the operation flow, NOT from the inspection ROI (`state.roi`),
 * which is reserved for Spectra/Region averaging. Every region-requesting action
 * (crop, Spectralon, the contrast tool, bit shift) reads through these helpers, so
 * none of them silently consumes a stale inspection ROI.
 */
export interface OperationRegionCornerParameterIds {
  readonly x0: string;
  readonly y0: string;
  readonly x1: string;
  readonly y1: string;
}

export function readOperationRegionOrNull(
  sourceRenderingState: ViewportRenderingState,
): ViewportRoi | null {
  return sourceRenderingState.operationRegion;
}

export function requireOperationRegionForApply(
  sourceRenderingState: ViewportRenderingState,
  operationLabel: string,
): ViewportRoi {
  const region = sourceRenderingState.operationRegion;
  if (!region) throw new Error(describeMissingOperationRegionError(operationLabel));
  return region;
}

function describeMissingOperationRegionError(operationLabel: string): string {
  return `${operationLabel} needs a region. Select a region for this operation first.`;
}

export function injectOperationRegionCorners(
  parameterValues: ParameterValuesById,
  region: ViewportRoi,
  cornerParameterIds: OperationRegionCornerParameterIds,
): ParameterValuesById {
  return Object.freeze({
    ...parameterValues,
    [cornerParameterIds.x0]: region.imagePixelX0,
    [cornerParameterIds.y0]: region.imagePixelY0,
    [cornerParameterIds.x1]: region.imagePixelX1,
    [cornerParameterIds.y1]: region.imagePixelY1,
  });
}

export function clearOperationRegionFromState(
  state: ViewportRenderingState,
): ViewportRenderingState {
  return { ...state, operationRegion: null };
}
