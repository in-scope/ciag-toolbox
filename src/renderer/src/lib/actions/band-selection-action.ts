import { ListChecks } from "lucide-react";

import {
  flattenBandMatrixToFloat32,
  reduceCubeToSelectedBandInChunks,
  type BandSelectionPreset,
} from "@/lib/image/band-ops/band-selection";
import {
  describeCustomBandSelectionForAudit,
  isCustomBandSelection,
  type CustomBandSelection,
} from "@/lib/image/band-ops/band-selection-editing";
import {
  describeScriptErrorWithDocsHint,
  validateBandSelectionReturnValue,
} from "@/lib/image/band-ops/user-script-return-contract";
import { makeFloat32RasterFromBands } from "@/lib/image/make-float-raster";
import { throwIfOperationStopped } from "@/lib/image/operation-stop";
import { coerceViewportSourceToRasterSource } from "@/lib/image/promote-source-to-raster";
import {
  EMPTY_PINNED_ROI_SPECTRA,
  EMPTY_PINNED_SPECTRA,
} from "@/lib/image/spectrum-entry";
import type { RasterImage } from "@/lib/image/raster-image";
import {
  runUserScriptOverRasterAtApply,
  type ApplyTimeUserScriptRunner,
} from "@/lib/python/run-user-script-at-apply";

import type { ParameterValuesById } from "./parameter-schema";
import type { RegisteredViewportAction } from "./registered-actions";
import {
  closeBandSubsetEditorAndClearFunctionChoice,
  clearBandSelectionEditingState,
  EMPTY_REMOVED_BAND_INDEXES,
  type ViewportActionAsyncSourceTransform,
  type ViewportRenderingState,
} from "./viewport-action";

// CT-210: reduce a stack to ONE summary band, chosen by a ready-made preset
// (average / variance) or by the user's own Python. The current choice rides in
// ViewportRenderingState (written by the embedded editor), and Apply injects it
// into the parameter values for the audit trail. The output is a NEW single-band
// float32 stack.
//
// CT-284: this action has NO menu entry anymore. Its editor lives inside the
// Subset Bands editor's "By function" mode (band-selection-function-editor.tsx),
// which applies through this same action so History keeps the "Band selection"
// vocabulary and old projects render as saved.
//
// CT-293: the three functions are one exclusive choice and ALL of them run at
// Apply, the CT-216 custom-transform pattern. The editor only configures the
// input, so an imported script is re-read from disk on every Apply, a failed run
// leaves the editor open with the configuration intact, and Stop kills the
// Python subprocess mid-run.

export const BAND_SELECTION_ACTION_ID = "band-selection";
const BAND_SELECTION_PRESET_PARAMETER_ID = "preset";
const BAND_SELECTION_EXPRESSION_PARAMETER_ID = "customBandExpression";
const BAND_SELECTION_SCRIPT_PATH_PARAMETER_ID = "customBandScriptPath";
const BAND_SELECTION_DESCRIPTION_PARAMETER_ID = "customBandDescription";
const SELECTED_BAND_LABEL = "Selected band";

const NO_FUNCTION_CHOSEN_MESSAGE =
  "Band selection needs a function. Pick Average, Variance, or Custom first.";
const NO_CUSTOM_INPUT_CONFIGURED_MESSAGE =
  "Custom needs a formula or an imported tool. Enter one first.";

const PRESET_LABELS: Record<BandSelectionPreset, string> = {
  average: "average",
  variance: "variance",
};

export const BAND_SELECTION_ACTION: RegisteredViewportAction = {
  id: BAND_SELECTION_ACTION_ID,
  label: "Band Selection",
  icon: ListChecks,
  successMessage: "Band selection applied",
  appliedLabel: "Band selection",
  loadingMessage: "Reducing to a single band...",
  // The Subset Bands editor closes through clearConsumedSourceStateAfterApply,
  // which the flow runs only on success, so a failed run leaves it open with the
  // configured function intact on both surfaces this action applies from.
  keepsPanelOpenUntilApplySucceeds: true,
  formatAppliedLabel: formatBandSelectionAppliedLabel,
  prepareParameterValuesForApply: injectBandSelectionChoiceForApply,
  apply: resetStateForSelectedBandOutput,
  clearConsumedSourceStateAfterApply: closeBandSubsetEditorAndClearFunctionChoice,
  supportsStopDuringApply: true,
  transformSourceAsync: createBandSelectionSourceTransform(),
};

function injectBandSelectionChoiceForApply(
  rawParameterValues: ParameterValuesById,
  sourceRenderingState: ViewportRenderingState,
): ParameterValuesById {
  const choice = sourceRenderingState.bandSelection;
  if (!choice) throw new Error(NO_FUNCTION_CHOSEN_MESSAGE);
  if (!isCustomBandSelection(choice)) {
    return Object.freeze({ ...rawParameterValues, [BAND_SELECTION_PRESET_PARAMETER_ID]: choice.preset });
  }
  return Object.freeze({
    ...rawParameterValues,
    ...buildConfiguredCustomInputParameter(choice),
    [BAND_SELECTION_DESCRIPTION_PARAMETER_ID]: describeCustomBandSelectionForAudit(choice),
  });
}

function buildConfiguredCustomInputParameter(choice: CustomBandSelection): ParameterValuesById {
  if (choice.kind === "tool") return { [BAND_SELECTION_SCRIPT_PATH_PARAMETER_ID]: choice.filePath };
  const expression = choice.expression.trim();
  if (expression === "") throw new Error(NO_CUSTOM_INPUT_CONFIGURED_MESSAGE);
  return { [BAND_SELECTION_EXPRESSION_PARAMETER_ID]: expression };
}

// The selected band is a single band, so band-dependent viewer state resets like
// the other band-count-changing operations, and the consumed choice clears.
function resetStateForSelectedBandOutput(state: ViewportRenderingState): ViewportRenderingState {
  return clearBandSelectionEditingState({
    ...state,
    selectedBandIndex: 0,
    removedBandIndexes: EMPTY_REMOVED_BAND_INDEXES,
    isBandSubsetEditModeActive: false,
    pinnedSpectra: EMPTY_PINNED_SPECTRA,
    pinnedRoiSpectra: EMPTY_PINNED_ROI_SPECTRA,
  });
}

export function createBandSelectionSourceTransform(
  runScript: ApplyTimeUserScriptRunner = runBandSelectionScriptThroughWorker,
): ViewportActionAsyncSourceTransform {
  return async (rawSource, parameterValues, onProgress, abortSignal) => {
    const { raster } = coerceViewportSourceToRasterSource(rawSource);
    const band = await deriveSelectedBand(runScript, raster, parameterValues, onProgress, abortSignal);
    return { kind: "raster", raster: buildSingleBandStack(raster, band) };
  };
}

function deriveSelectedBand(
  runScript: ApplyTimeUserScriptRunner,
  raster: RasterImage,
  parameterValues: ParameterValuesById,
  onProgress: ((fraction: number) => void) | undefined,
  abortSignal: AbortSignal | undefined,
): Promise<Float32Array> {
  const scriptSource = readConfiguredScriptSourceOrNull(parameterValues);
  if (scriptSource) {
    return runScriptForDerivedBand(runScript, raster, scriptSource, onProgress, abortSignal);
  }
  const preset = readBandSelectionPreset(parameterValues);
  return reduceCubeToSelectedBandInChunks(raster.bandPixels, preset, onProgress, abortSignal);
}

async function runScriptForDerivedBand(
  runScript: ApplyTimeUserScriptRunner,
  raster: RasterImage,
  scriptSource: ToolboxRunUserScriptSource,
  onProgress: ((fraction: number) => void) | undefined,
  abortSignal: AbortSignal | undefined,
): Promise<Float32Array> {
  const result = await runScript(raster, scriptSource, onProgress, abortSignal);
  // A stopped run may still settle with SOME outcome (the killed worker reports
  // a failure); the signal, not the outcome, decides "stopped".
  throwIfOperationStopped(abortSignal);
  return buildDerivedBandFromRunResult(raster, result);
}

function runBandSelectionScriptThroughWorker(
  raster: RasterImage,
  source: ToolboxRunUserScriptSource,
  onProgress?: (fraction: number) => void,
  abortSignal?: AbortSignal,
): Promise<ToolboxRunUserScriptResult> {
  return runUserScriptOverRasterAtApply(raster, source, "value", onProgress, abortSignal);
}

function buildDerivedBandFromRunResult(
  raster: RasterImage,
  result: ToolboxRunUserScriptResult,
): Float32Array {
  if (result.status !== "completed") {
    throw new Error(describeScriptErrorWithDocsHint(describeUnusableRunOutcome(result)));
  }
  const rows = validateBandSelectionReturnValue(result.value, {
    height: raster.height,
    width: raster.width,
  });
  return flattenBandMatrixToFloat32(rows, raster.width, raster.height);
}

function describeUnusableRunOutcome(
  result: Exclude<ToolboxRunUserScriptResult, { status: "completed" }>,
): string {
  if (result.status === "failed") return result.message;
  if (result.status === "canceled") return "The band run was canceled.";
  return "The script returned an unexpected result.";
}

function buildSingleBandStack(raster: RasterImage, band: Float32Array): RasterImage {
  return makeFloat32RasterFromBands(
    { width: raster.width, height: raster.height, bandLabels: [SELECTED_BAND_LABEL] },
    [band],
  );
}

function readConfiguredScriptSourceOrNull(
  parameterValues: ParameterValuesById,
): ToolboxRunUserScriptSource | null {
  const expression = parameterValues[BAND_SELECTION_EXPRESSION_PARAMETER_ID];
  if (typeof expression === "string") return { mode: "formula", expression };
  const scriptPath = parameterValues[BAND_SELECTION_SCRIPT_PATH_PARAMETER_ID];
  return typeof scriptPath === "string" ? { mode: "import", scriptPath } : null;
}

function readBandSelectionPreset(parameterValues: ParameterValuesById): BandSelectionPreset {
  return parameterValues[BAND_SELECTION_PRESET_PARAMETER_ID] === "variance" ? "variance" : "average";
}

function formatBandSelectionAppliedLabel(parameterValues: ParameterValuesById): string {
  const description = parameterValues[BAND_SELECTION_DESCRIPTION_PARAMETER_ID];
  if (typeof description === "string") return `Band selection (${description})`;
  return `Band selection (${PRESET_LABELS[readBandSelectionPreset(parameterValues)]})`;
}
