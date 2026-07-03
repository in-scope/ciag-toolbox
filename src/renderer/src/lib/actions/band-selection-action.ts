import { Sigma } from "lucide-react";

import {
  reduceCubeToSelectedBand,
  type BandSelectionPreset,
} from "@/lib/image/band-ops/band-selection";
import { readRememberedBandSelectionResultOrNull } from "@/lib/image/band-ops/band-selection-result-store";
import { makeFloat32RasterFromBands } from "@/lib/image/make-float-raster";
import { coerceViewportSourceToRasterSource } from "@/lib/image/promote-source-to-raster";
import {
  EMPTY_PINNED_ROI_SPECTRA,
  EMPTY_PINNED_SPECTRA,
} from "@/lib/image/spectrum-entry";
import type { RasterImage } from "@/lib/image/raster-image";

import type { ParameterValuesById } from "./parameter-schema";
import type { RegisteredViewportAction } from "./registered-actions";
import {
  clearBandSelectionEditingState,
  EMPTY_REMOVED_BAND_INDEXES,
  type ViewportActionSourceTransform,
  type ViewportRenderingState,
} from "./viewport-action";

// CT-210: reduce a stack to ONE summary band, chosen by a ready-made preset
// (average / variance), a quick Python formula, or an imported tool. A preset is
// recomputed synchronously at Apply; a formula/tool result is a full band the
// scripting worker already produced, remembered in the result store under a token.
// The current choice rides in ViewportRenderingState (written by the embedded
// editor), and Apply injects it into the parameter values for the audit trail.
// The output is a NEW single-band float32 stack.

export const BAND_SELECTION_ACTION_ID = "band-selection";
const BAND_SELECTION_PRESET_PARAMETER_ID = "preset";
const BAND_SELECTION_TOKEN_PARAMETER_ID = "customBandToken";
const BAND_SELECTION_DESCRIPTION_PARAMETER_ID = "customBandDescription";
const SELECTED_BAND_LABEL = "Selected band";

const PRESET_LABELS: Record<BandSelectionPreset, string> = {
  average: "average",
  variance: "variance",
};

export const BAND_SELECTION_ACTION: RegisteredViewportAction = {
  id: BAND_SELECTION_ACTION_ID,
  label: "Band Selection",
  icon: Sigma,
  successMessage: "Band selection applied",
  appliedLabel: "Band selection",
  loadingMessage: "Reducing to a single band...",
  formatAppliedLabel: formatBandSelectionAppliedLabel,
  prepareParameterValuesForApply: injectBandSelectionChoiceForApply,
  apply: resetStateForSelectedBandOutput,
  clearConsumedSourceStateAfterApply: clearBandSelectionEditingState,
  transformSource: createBandSelectionSourceTransform(),
};

function injectBandSelectionChoiceForApply(
  rawParameterValues: ParameterValuesById,
  sourceRenderingState: ViewportRenderingState,
): ParameterValuesById {
  const choice = sourceRenderingState.bandSelection;
  if (!choice) {
    throw new Error("Band selection needs a function. Pick a preset or run a formula or tool first.");
  }
  if (choice.kind === "custom") {
    return Object.freeze({
      ...rawParameterValues,
      [BAND_SELECTION_TOKEN_PARAMETER_ID]: choice.token,
      [BAND_SELECTION_DESCRIPTION_PARAMETER_ID]: choice.description,
    });
  }
  return Object.freeze({ ...rawParameterValues, [BAND_SELECTION_PRESET_PARAMETER_ID]: choice.preset });
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

function createBandSelectionSourceTransform(): ViewportActionSourceTransform {
  return (rawSource, parameterValues) => {
    const source = coerceViewportSourceToRasterSource(rawSource);
    return { kind: "raster", raster: buildSelectedBandStack(source.raster, parameterValues) };
  };
}

function buildSelectedBandStack(raster: RasterImage, parameterValues: ParameterValuesById): RasterImage {
  const token = readCustomBandToken(parameterValues);
  if (token !== null) return buildStackFromRememberedCustomBand(token);
  return buildStackFromPreset(raster, readBandSelectionPreset(parameterValues));
}

function buildStackFromPreset(raster: RasterImage, preset: BandSelectionPreset): RasterImage {
  const band = reduceCubeToSelectedBand(raster.bandPixels, preset);
  return makeFloat32RasterFromBands(
    { width: raster.width, height: raster.height, bandLabels: [SELECTED_BAND_LABEL] },
    [band],
  );
}

function buildStackFromRememberedCustomBand(token: string): RasterImage {
  const result = readRememberedBandSelectionResultOrNull(token);
  if (!result) {
    throw new Error("The computed band is no longer available. Run the formula or tool again.");
  }
  return makeFloat32RasterFromBands(
    { width: result.width, height: result.height, bandLabels: [SELECTED_BAND_LABEL] },
    [result.values],
  );
}

function readCustomBandToken(parameterValues: ParameterValuesById): string | null {
  const raw = parameterValues[BAND_SELECTION_TOKEN_PARAMETER_ID];
  return typeof raw === "string" ? raw : null;
}

function readBandSelectionPreset(parameterValues: ParameterValuesById): BandSelectionPreset {
  return parameterValues[BAND_SELECTION_PRESET_PARAMETER_ID] === "variance" ? "variance" : "average";
}

function formatBandSelectionAppliedLabel(parameterValues: ParameterValuesById): string {
  const description = parameterValues[BAND_SELECTION_DESCRIPTION_PARAMETER_ID];
  if (typeof description === "string") return `Band selection (${description})`;
  return `Band selection (${PRESET_LABELS[readBandSelectionPreset(parameterValues)]})`;
}
