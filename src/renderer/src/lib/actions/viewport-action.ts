import type { ToneCurveAnchor } from "@/lib/image/apply-tone-curve";
import {
  DEFAULT_TONE_CURVE_CHANNEL,
  type ToneCurveChannel,
  type ToneCurveChannelAnchors,
} from "@/lib/image/tone-curve-channels";
import {
  EMPTY_PINNED_ROI_SPECTRA,
  EMPTY_PINNED_SPECTRA,
  type PinnedRoiSpectraList,
  type PinnedSpectraList,
} from "@/lib/image/spectrum-entry";
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
  readonly operationRegion: ViewportRoi | null;
  readonly toneCurveAnchors: ReadonlyArray<ToneCurveAnchor> | null;
  readonly toneCurveChannelAnchors: ToneCurveChannelAnchors;
  readonly toneCurveActiveChannel: ToneCurveChannel;
  readonly pinnedSpectra: PinnedSpectraList;
  readonly pinnedRoiSpectra: PinnedRoiSpectraList;
  readonly removedBandIndexes: ReadonlyArray<number>;
  readonly isBandSubsetEditModeActive: boolean;
}

export const EMPTY_REMOVED_BAND_INDEXES: ReadonlyArray<number> = Object.freeze([]);

export const EMPTY_TONE_CURVE_CHANNEL_ANCHORS: ToneCurveChannelAnchors = Object.freeze({});

export const DEFAULT_VIEWPORT_RENDERING_STATE: ViewportRenderingState = {
  normalizationEnabled: false,
  lastAppliedOperationLabel: null,
  selectedBandIndex: 0,
  operationHistory: EMPTY_OPERATION_HISTORY,
  roi: null,
  operationRegion: null,
  toneCurveAnchors: null,
  toneCurveChannelAnchors: EMPTY_TONE_CURVE_CHANNEL_ANCHORS,
  toneCurveActiveChannel: DEFAULT_TONE_CURVE_CHANNEL,
  pinnedSpectra: EMPTY_PINNED_SPECTRA,
  pinnedRoiSpectra: EMPTY_PINNED_ROI_SPECTRA,
  removedBandIndexes: EMPTY_REMOVED_BAND_INDEXES,
  isBandSubsetEditModeActive: false,
};

export function hasToneCurveEditingState(state: ViewportRenderingState): boolean {
  return (
    state.toneCurveAnchors !== null ||
    state.toneCurveActiveChannel !== DEFAULT_TONE_CURVE_CHANNEL ||
    Object.keys(state.toneCurveChannelAnchors).length > 0
  );
}

export function clearToneCurveEditingState(state: ViewportRenderingState): ViewportRenderingState {
  return {
    ...state,
    toneCurveAnchors: null,
    toneCurveChannelAnchors: EMPTY_TONE_CURVE_CHANNEL_ANCHORS,
    toneCurveActiveChannel: DEFAULT_TONE_CURVE_CHANNEL,
  };
}

export type ViewportActionSourceTransform = (
  source: ViewportImageSource,
  parameterValues: ParameterValuesById,
) => ViewportImageSource;

// CT-097: an operation may emit additional outputs beyond the primary in-place /
// duplicated result. Each secondary output is placed in its own fresh viewport
// and carries its own applied label so the audit trail records the extra step.
export interface ViewportActionOutput {
  readonly source: ViewportImageSource;
  readonly appliedLabel: string;
}

export type ViewportActionSecondaryOutputsTransform = (
  source: ViewportImageSource,
  parameterValues: ParameterValuesById,
) => ReadonlyArray<ViewportActionOutput>;

export type ApplyScope = "whole-image" | "roi";

export const DEFAULT_APPLY_SCOPE: ApplyScope = "whole-image";

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
