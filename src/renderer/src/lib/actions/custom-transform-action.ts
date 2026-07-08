import { Wand2 } from "lucide-react";

import {
  validateTransformedCubeAgainstSource,
  buildTransformOutputBandMetadata,
  type TransformedCubeResult,
  type TransformSourceBandMetadata,
} from "@/lib/image/band-ops/cube-transform-contract";
import {
  readRememberedCubeTransformResultOrNull,
  type RememberedCubeTransformResult,
} from "@/lib/image/band-ops/cube-transform-result-store";
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
  clearCubeTransformEditingState,
  EMPTY_REMOVED_BAND_INDEXES,
  type ViewportActionSourceTransform,
  type ViewportRenderingState,
} from "./viewport-action";

// CT-216: transform the WHOLE cube with a one-line Python formula or an imported
// .py/.zip tool. The scripting worker already produced the transformed cube at
// Run formula / Import script time (the CT-209/210 model); it is remembered in
// the cube-transform result store under a token, and the ready choice rides in
// ViewportRenderingState (written by the embedded editor). Apply resolves the
// token synchronously, re-validates it against the source it is applied to, and
// builds a NEW float32 stack whose band count is free (metadata carries through
// only when the band count is unchanged).

export const CUSTOM_TRANSFORM_ACTION_ID = "custom-transform";
const CUSTOM_TRANSFORM_TOKEN_PARAMETER_ID = "customTransformToken";
const CUSTOM_TRANSFORM_DESCRIPTION_PARAMETER_ID = "customTransformDescription";

export const CUSTOM_TRANSFORM_ACTION: RegisteredViewportAction = {
  id: CUSTOM_TRANSFORM_ACTION_ID,
  label: "Custom Transform",
  icon: Wand2,
  successMessage: "Custom transform applied",
  appliedLabel: "Custom transform",
  loadingMessage: "Transforming the stack...",
  formatAppliedLabel: formatCustomTransformAppliedLabel,
  prepareParameterValuesForApply: injectCubeTransformChoiceForApply,
  apply: resetStateForTransformedStackOutput,
  clearConsumedSourceStateAfterApply: clearCubeTransformEditingState,
  transformSource: createCustomTransformSourceTransform(),
};

function injectCubeTransformChoiceForApply(
  rawParameterValues: ParameterValuesById,
  sourceRenderingState: ViewportRenderingState,
): ParameterValuesById {
  const choice = sourceRenderingState.cubeTransform;
  if (!choice) {
    throw new Error("Custom transform needs a transform. Run a formula or import a tool first.");
  }
  return Object.freeze({
    ...rawParameterValues,
    [CUSTOM_TRANSFORM_TOKEN_PARAMETER_ID]: choice.token,
    [CUSTOM_TRANSFORM_DESCRIPTION_PARAMETER_ID]: choice.auditDescription,
  });
}

// The output band count can differ from the source, so band-dependent viewer
// state resets like the other band-count-changing operations, and the consumed
// choice clears.
function resetStateForTransformedStackOutput(
  state: ViewportRenderingState,
): ViewportRenderingState {
  return clearCubeTransformEditingState({
    ...state,
    selectedBandIndex: 0,
    removedBandIndexes: EMPTY_REMOVED_BAND_INDEXES,
    isBandSubsetEditModeActive: false,
    pinnedSpectra: EMPTY_PINNED_SPECTRA,
    pinnedRoiSpectra: EMPTY_PINNED_ROI_SPECTRA,
  });
}

function createCustomTransformSourceTransform(): ViewportActionSourceTransform {
  return (rawSource, parameterValues) => {
    const source = coerceViewportSourceToRasterSource(rawSource);
    return { kind: "raster", raster: buildTransformedStack(source.raster, parameterValues) };
  };
}

function buildTransformedStack(
  raster: RasterImage,
  parameterValues: ParameterValuesById,
): RasterImage {
  const remembered = readRememberedTransformOrThrow(readTransformTokenOrThrow(parameterValues));
  const validated = validateTransformedCubeAgainstSource(
    remembered.shape,
    remembered.bands,
    raster.height,
    raster.width,
  );
  return buildFloat32StackFromValidatedCube(raster, validated);
}

function readTransformTokenOrThrow(parameterValues: ParameterValuesById): string {
  const raw = parameterValues[CUSTOM_TRANSFORM_TOKEN_PARAMETER_ID];
  if (typeof raw !== "string") {
    throw new Error("Custom transform needs a transform. Run a formula or import a tool first.");
  }
  return raw;
}

function readRememberedTransformOrThrow(token: string): RememberedCubeTransformResult {
  const result = readRememberedCubeTransformResultOrNull(token);
  if (!result) {
    throw new Error("The transformed stack is no longer available. Run the formula or tool again.");
  }
  return result;
}

function buildFloat32StackFromValidatedCube(
  raster: RasterImage,
  cube: TransformedCubeResult,
): RasterImage {
  const metadata = buildTransformOutputBandMetadata(
    readSourceBandMetadata(raster),
    cube.bands.length,
  );
  const output = makeFloat32RasterFromBands(
    { width: raster.width, height: raster.height, bandLabels: metadata.bandLabels },
    cube.bands,
  );
  return metadata.bandWavelengths ? { ...output, bandWavelengths: metadata.bandWavelengths } : output;
}

function readSourceBandMetadata(raster: RasterImage): TransformSourceBandMetadata {
  return {
    bandCount: raster.bandCount,
    bandLabels: raster.bandLabels,
    bandWavelengths: raster.bandWavelengths,
  };
}

function formatCustomTransformAppliedLabel(parameterValues: ParameterValuesById): string {
  const description = parameterValues[CUSTOM_TRANSFORM_DESCRIPTION_PARAMETER_ID];
  if (typeof description === "string") return `Custom transform (${description})`;
  return "Custom transform";
}
