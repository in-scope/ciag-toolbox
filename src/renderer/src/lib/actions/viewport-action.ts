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
import type { BandSelectionEditingState } from "@/lib/image/band-ops/band-selection";
import type { CubeTransformEditingState } from "@/lib/image/band-ops/cube-transform-editing";
import type { ThresholdOtsuCutoffs } from "@/lib/image/threshold/otsu-cutoffs";
import type { ThresholdBounds } from "@/lib/image/threshold/threshold";
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
  readonly floatDisplayUsesFixedUnitWindow: boolean;
  readonly viewChannelsSeparately: boolean;
  readonly lastAppliedOperationLabel: string | null;
  readonly selectedBandIndex: number;
  readonly operationHistory: ViewportOperationHistory;
  readonly roi: ViewportRoi | null;
  readonly operationRegion: ViewportRoi | null;
  readonly toneCurveAnchors: ReadonlyArray<ToneCurveAnchor> | null;
  readonly toneCurveChannelAnchors: ToneCurveChannelAnchors;
  readonly toneCurveActiveChannel: ToneCurveChannel;
  readonly thresholdBounds: ThresholdBounds | null;
  readonly thresholdOtsuCutoffs: ThresholdOtsuCutoffs | null;
  readonly bandWeights: ReadonlyArray<number> | null;
  readonly bandSelection: BandSelectionEditingState | null;
  readonly cubeTransform: CubeTransformEditingState | null;
  readonly pinnedSpectra: PinnedSpectraList;
  readonly pinnedRoiSpectra: PinnedRoiSpectraList;
  readonly removedBandIndexes: ReadonlyArray<number>;
  readonly isBandSubsetEditModeActive: boolean;
}

export const EMPTY_REMOVED_BAND_INDEXES: ReadonlyArray<number> = Object.freeze([]);

export const EMPTY_TONE_CURVE_CHANNEL_ANCHORS: ToneCurveChannelAnchors = Object.freeze({});

export const DEFAULT_VIEWPORT_RENDERING_STATE: ViewportRenderingState = {
  normalizationEnabled: false,
  floatDisplayUsesFixedUnitWindow: false,
  viewChannelsSeparately: false,
  lastAppliedOperationLabel: null,
  selectedBandIndex: 0,
  operationHistory: EMPTY_OPERATION_HISTORY,
  roi: null,
  operationRegion: null,
  toneCurveAnchors: null,
  toneCurveChannelAnchors: EMPTY_TONE_CURVE_CHANNEL_ANCHORS,
  toneCurveActiveChannel: DEFAULT_TONE_CURVE_CHANNEL,
  thresholdBounds: null,
  thresholdOtsuCutoffs: null,
  bandWeights: null,
  bandSelection: null,
  cubeTransform: null,
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

// CT-200: the threshold popup's live bounds live in rendering state (like the
// tone-curve anchors) so the editor, the GPU preview, and Apply all read one
// source of truth. Opening/closing the panel and Apply clear them. CT-201: the
// Auto button's per-band Otsu cutoffs ride alongside the bounds and clear with
// them; any manual bound edit also discards them (the editor handles that).
export function hasThresholdEditingState(state: ViewportRenderingState): boolean {
  return state.thresholdBounds !== null || state.thresholdOtsuCutoffs !== null;
}

export function clearThresholdEditingState(state: ViewportRenderingState): ViewportRenderingState {
  return { ...state, thresholdBounds: null, thresholdOtsuCutoffs: null };
}

// CT-209: the band-weighting popup's per-band weights live in rendering state
// (the same editor-owned pattern as the threshold bounds), so the weight fields,
// a formula/imported-tool result, and Apply all read one source of truth. Opening
// or closing the panel and Apply clear them.
export function hasBandWeightingEditingState(state: ViewportRenderingState): boolean {
  return state.bandWeights !== null;
}

export function clearBandWeightingEditingState(state: ViewportRenderingState): ViewportRenderingState {
  return { ...state, bandWeights: null };
}

// CT-210: the band-selection popup's current choice (a preset, or a custom
// formula/tool result token) lives in rendering state, the same editor-owned
// pattern as the band weights. Opening or closing the panel and Apply clear it.
export function hasBandSelectionEditingState(state: ViewportRenderingState): boolean {
  return state.bandSelection !== null;
}

export function clearBandSelectionEditingState(state: ViewportRenderingState): ViewportRenderingState {
  return { ...state, bandSelection: null };
}

// CT-216: the Custom transform popup's ready transform (a result-store token plus
// display strings, never band data) lives in rendering state, the same
// editor-owned pattern as the band selection choice. Opening or closing the
// panel and Apply clear it.
export function hasCubeTransformEditingState(state: ViewportRenderingState): boolean {
  return state.cubeTransform !== null;
}

export function clearCubeTransformEditingState(state: ViewportRenderingState): ViewportRenderingState {
  return { ...state, cubeTransform: null };
}

// CT-233: transforms receive the LIVE source, never a defensive clone (the apply
// flow stopped deep-copying the cube). A transform must treat the input source as
// immutable: return a new source object, never write into the input's band arrays
// or metadata. Unchanged bands SHOULD be carried into the result by reference
// (makeFloatRasterReusingUnchangedSourceBands and friends), which is safe exactly
// because no transform ever mutates a band buffer in place.
export type ViewportActionSourceTransform = (
  source: ViewportImageSource,
  parameterValues: ParameterValuesById,
) => ViewportImageSource;

// CT-221: an async transform reports determinate progress (a 0..1 fraction, one
// tick per completed band or equivalent unit) through this callback; the apply
// flow forwards it to the busy entry so the overlay shows a percentage.
export type TransformProgressCallback = (fraction: number) => void;

// CT-219a: a source transform may instead be asynchronous (the spatial filter
// runs its FFT loop on a Web Worker so a large stack does not freeze the UI
// thread). An action defines transformSource OR transformSourceAsync; the apply
// flow gates and runs both kinds only through actionTransformsSource /
// runActionSourceTransform below.
export type ViewportActionAsyncSourceTransform = (
  source: ViewportImageSource,
  parameterValues: ParameterValuesById,
  onProgress?: TransformProgressCallback,
) => Promise<ViewportImageSource>;

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

// CT-190: a pre-flight check that throws a user-facing Error when the action
// cannot run against the given source (e.g. RGB-to-grayscale on a non-3-band
// image). The apply flow runs it BEFORE reserving a result panel, so a doomed
// operation surfaces its error without leaving a blank panel behind.
export type ViewportActionSourceApplicabilityCheck = (
  source: ViewportImageSource,
  parameterValues: ParameterValuesById,
) => void;

// CT-192: "whole-stack" applies one operation across every band of a stack (the tone
// curve's whole-stack scope). "whole-image" still means the selected band over the full
// spatial extent; "roi" limits the operation to a selected region.
export type ApplyScope = "whole-image" | "roi" | "whole-stack";

export const DEFAULT_APPLY_SCOPE: ApplyScope = "whole-image";

// CT-192: an action can offer a custom set of scope options (label + scope). Actions
// without a custom set fall back to the default "Whole stack | Region of interest" pair.
export interface ApplyScopeOption {
  readonly scope: ApplyScope;
  readonly label: string;
}

export const DEFAULT_APPLY_SCOPE_OPTIONS: ReadonlyArray<ApplyScopeOption> = Object.freeze([
  { scope: "whole-image", label: "Whole stack" },
  { scope: "roi", label: "Region of interest" },
]);

export interface ViewportAction {
  readonly id: string;
  readonly label: string;
  readonly parameters?: ReadonlyArray<ParameterSchema>;
  readonly apply: (
    viewportState: ViewportRenderingState,
    parameterValues: ParameterValuesById,
  ) => ViewportRenderingState;
  readonly transformSource?: ViewportActionSourceTransform;
  readonly transformSourceAsync?: ViewportActionAsyncSourceTransform;
}

export function actionTransformsSource(action: ViewportAction): boolean {
  return action.transformSource !== undefined || action.transformSourceAsync !== undefined;
}

export async function runActionSourceTransform(
  action: ViewportAction,
  source: ViewportImageSource,
  parameterValues: ParameterValuesById,
  onProgress?: TransformProgressCallback,
): Promise<ViewportImageSource> {
  if (action.transformSourceAsync) {
    return action.transformSourceAsync(source, parameterValues, onProgress);
  }
  if (action.transformSource) return action.transformSource(source, parameterValues);
  return source;
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
