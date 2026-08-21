import { Diff } from "lucide-react";

import {
  EMPTY_PINNED_ROI_SPECTRA,
  EMPTY_PINNED_SPECTRA,
} from "@/lib/image/spectrum-entry";
import { coerceViewportSourceToRasterSource } from "@/lib/image/promote-source-to-raster";
import {
  assertCubeHasEnoughBandsForSpectralDerivativeOrder,
  computeSpectralDerivativeReportingProgress,
  describeSpectralDerivativeOrder,
  FIRST_ORDER_SPECTRAL_DERIVATIVE,
  SECOND_ORDER_SPECTRAL_DERIVATIVE,
  type SpectralDerivativeOrder,
} from "@/lib/image/spectral/spectral-derivative";
import type { ViewportImageSource } from "@/lib/webgl/texture";

import type { EnumParameterSchema, ParameterValuesById } from "./parameter-schema";
import type { RegisteredViewportAction } from "./registered-actions";
import {
  EMPTY_REMOVED_BAND_INDEXES,
  type ViewportActionAsyncSourceTransform,
  type ViewportRenderingState,
} from "./viewport-action";

// CT-202: spectral derivative along the wavelength axis. The order selector is
// the only parameter; the output is a NEW float32 stack (N - order bands) that
// defaults to "Open in a new panel" like every other operation, and the audit
// trail records the chosen order via the applied label.

export const SPECTRAL_DERIVATIVE_ACTION_ID = "spectral-derivative";
export const SPECTRAL_DERIVATIVE_ORDER_PARAMETER_ID = "order";

const FIRST_ORDER_OPTION_VALUE = "1";
const SECOND_ORDER_OPTION_VALUE = "2";

const SPECTRAL_DERIVATIVE_ORDER_PARAMETER_SCHEMA: EnumParameterSchema = {
  kind: "enum",
  id: SPECTRAL_DERIVATIVE_ORDER_PARAMETER_ID,
  label: "Order",
  description:
    "1st order differences each band from the next along the wavelength axis. " +
    "2nd order differences those differences, emphasizing absorption features.",
  defaultValue: FIRST_ORDER_OPTION_VALUE,
  options: [
    { value: FIRST_ORDER_OPTION_VALUE, label: "1st order" },
    { value: SECOND_ORDER_OPTION_VALUE, label: "2nd order" },
  ],
};

export const SPECTRAL_DERIVATIVE_ACTION: RegisteredViewportAction = {
  id: SPECTRAL_DERIVATIVE_ACTION_ID,
  label: "Spectral Derivative",
  icon: Diff,
  parameters: [SPECTRAL_DERIVATIVE_ORDER_PARAMETER_SCHEMA],
  successMessage: "Spectral derivative applied",
  appliedLabel: "Spectral derivative",
  loadingMessage: "Computing spectral derivative...",
  formatAppliedLabel: formatSpectralDerivativeAppliedLabel,
  assertCanApplyToSource: assertSourceStackHasEnoughBandsForChosenOrder,
  apply: resetBandDependentStateForDerivativeOutput,
  supportsStopDuringApply: true,
  transformSourceAsync: createSpectralDerivativeSourceTransform(),
};

export function readSpectralDerivativeOrder(
  parameterValues: ParameterValuesById,
): SpectralDerivativeOrder {
  if (parameterValues[SPECTRAL_DERIVATIVE_ORDER_PARAMETER_ID] === SECOND_ORDER_OPTION_VALUE) {
    return SECOND_ORDER_SPECTRAL_DERIVATIVE;
  }
  return FIRST_ORDER_SPECTRAL_DERIVATIVE;
}

// CT-190 pre-flight: a stack with fewer than order + 1 bands cannot be
// differenced, so the failure surfaces before a result panel is reserved.
function assertSourceStackHasEnoughBandsForChosenOrder(
  source: ViewportImageSource,
  parameterValues: ParameterValuesById,
): void {
  const raster = coerceViewportSourceToRasterSource(source).raster;
  assertCubeHasEnoughBandsForSpectralDerivativeOrder(raster, readSpectralDerivativeOrder(parameterValues));
}

function createSpectralDerivativeSourceTransform(): ViewportActionAsyncSourceTransform {
  return async (rawSource, parameterValues, onProgress, abortSignal) => {
    const source = coerceViewportSourceToRasterSource(rawSource);
    const order = readSpectralDerivativeOrder(parameterValues);
    const raster = await computeSpectralDerivativeReportingProgress(source.raster, order, onProgress, abortSignal);
    return { kind: "raster", raster };
  };
}

// The derivative stack has its own (smaller) band count, so band-dependent
// viewer state resets like the other band-count-changing operations.
function resetBandDependentStateForDerivativeOutput(
  state: ViewportRenderingState,
): ViewportRenderingState {
  return {
    ...state,
    selectedBandIndex: 0,
    removedBandIndexes: EMPTY_REMOVED_BAND_INDEXES,
    isBandSubsetEditModeActive: false,
    pinnedSpectra: EMPTY_PINNED_SPECTRA,
    pinnedRoiSpectra: EMPTY_PINNED_ROI_SPECTRA,
  };
}

function formatSpectralDerivativeAppliedLabel(parameterValues: ParameterValuesById): string {
  const orderText = describeSpectralDerivativeOrder(readSpectralDerivativeOrder(parameterValues));
  return `Spectral derivative (${orderText})`;
}
