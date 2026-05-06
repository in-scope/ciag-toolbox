import type { ViewportRoi } from "@/lib/image/viewport-roi";
import type { ViewportImageSource } from "@/lib/webgl/texture";

import { EMPTY_OPERATION_HISTORY, type ViewportOperationHistory } from "./operation-history";
import {
  NO_PARAMETER_VALUES,
  type ParameterSchema,
  type ParameterValuesById,
} from "./parameter-schema";

export interface ViewportRenderingState {
  readonly normalizationEnabled: boolean;
  readonly lastAppliedOperationLabel: string | null;
  readonly selectedBandIndex: number;
  readonly operationHistory: ViewportOperationHistory;
  readonly roi: ViewportRoi | null;
}

export const DEFAULT_VIEWPORT_RENDERING_STATE: ViewportRenderingState = {
  normalizationEnabled: false,
  lastAppliedOperationLabel: null,
  selectedBandIndex: 0,
  operationHistory: EMPTY_OPERATION_HISTORY,
  roi: null,
};

export type ViewportActionSourceTransform = (
  source: ViewportImageSource,
  parameterValues: ParameterValuesById,
) => ViewportImageSource;

export interface ViewportAction {
  readonly id: string;
  readonly label: string;
  readonly parameters?: ReadonlyArray<ParameterSchema>;
  readonly apply: (
    viewportState: ViewportRenderingState,
    parameterValues: ParameterValuesById,
  ) => ViewportRenderingState;
  readonly transformSource?: ViewportActionSourceTransform;
}

export interface ApplyActionFailure {
  readonly viewportIndex: number;
  readonly error: unknown;
}

export interface ApplyActionCallbacks {
  readonly getViewportRenderingState: (viewportIndex: number) => ViewportRenderingState;
  readonly setViewportRenderingState: (viewportIndex: number, next: ViewportRenderingState) => void;
  readonly reportApplyFailure: (failure: ApplyActionFailure) => void;
}

export function applyActionToSelectedViewports(
  action: ViewportAction,
  parameterValues: ParameterValuesById,
  selectedIndices: ReadonlySet<number>,
  callbacks: ApplyActionCallbacks,
): void {
  if (selectedIndices.size === 0) return;
  for (const viewportIndex of sortIndicesAscending(selectedIndices)) {
    applyActionToSingleViewport(action, parameterValues, viewportIndex, callbacks);
  }
}

function applyActionToSingleViewport(
  action: ViewportAction,
  parameterValues: ParameterValuesById,
  viewportIndex: number,
  callbacks: ApplyActionCallbacks,
): void {
  try {
    const previous = callbacks.getViewportRenderingState(viewportIndex);
    const next = action.apply(previous, parameterValues);
    callbacks.setViewportRenderingState(viewportIndex, next);
  } catch (error) {
    callbacks.reportApplyFailure({ viewportIndex, error });
  }
}

function sortIndicesAscending(indices: ReadonlySet<number>): readonly number[] {
  return Array.from(indices).sort((a, b) => a - b);
}

export { NO_PARAMETER_VALUES };
