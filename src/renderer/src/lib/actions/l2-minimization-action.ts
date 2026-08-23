import { Binary } from "lucide-react";

import { validateTransformedCubeAgainstSource } from "@/lib/image/band-ops/cube-transform-contract";
import {
  makeComponentStackFromProjection,
  readComponentStackSourceMeta,
} from "@/lib/image/dimension-reduction/transform-output";
import { throwIfOperationStopped } from "@/lib/image/operation-stop";
import { coerceViewportSourceToRasterSource } from "@/lib/image/promote-source-to-raster";
import type { RasterImage } from "@/lib/image/raster-image";
import type { MaskLayer } from "@/lib/masks/mask-layer";
import { readRememberedMaskLayerOrNull } from "@/lib/masks/mask-layer-reference-store";
import { runUserScriptOverRasterAtApply } from "@/lib/python/run-user-script-at-apply";

import {
  buildL2ExecuteParams,
  buildL2MaskArraysFromLayer,
  formatL2AppliedLabel,
  buildL2MinimizationParameterSchemas,
  readL2MinimizationSettings,
  type L2MinimizationSettings,
} from "./l2-minimization-params";
import { NO_MASK_LAYER_SELECTED } from "./parameter-schema";
import type { RegisteredViewportAction } from "./registered-actions";
import type {
  TransformProgressCallback,
  ViewportActionAsyncSourceTransform,
} from "./viewport-action";

// CT-313: the client's L2 binarization approximation
// (resources/builtin-python/l2_minimization.py, packaged and parity-pinned by
// CT-307). Unlike Local PCA/MNF, the run needs the chosen mask layer's pixel
// data as well as its numeric params, so it cannot reuse
// registerLocalProjectionAction's extras shape unchanged - the mask layer is
// resolved through lib/masks/mask-layer-reference-store.ts from the token the
// "mask-layer" parameter field carries.

export const L2_MINIMIZATION_ACTION_ID = "l2-minimization";
export const L2_MINIMIZATION_LABEL = "L2 Minimization";

const L2_MINIMIZATION_COMPONENT_LABEL_PREFIX = "L2 Minimization";

export const L2_MINIMIZATION_ACTION: RegisteredViewportAction = {
  id: L2_MINIMIZATION_ACTION_ID,
  label: L2_MINIMIZATION_LABEL,
  icon: Binary,
  parameters: buildL2MinimizationParameterSchemas(),
  successMessage: "L2 minimization applied",
  appliedLabel: L2_MINIMIZATION_LABEL,
  loadingMessage: "Computing the L2 binarization approximation...",
  formatAppliedLabel: formatL2AppliedLabel,
  apply: (state) => state,
  supportsStopDuringApply: true,
  transformSourceAsync: buildL2MinimizationSourceTransform(),
};

export type L2ScriptRunner = (
  raster: RasterImage,
  settings: L2MinimizationSettings,
  layer: MaskLayer,
  onProgress?: TransformProgressCallback,
  abortSignal?: AbortSignal,
) => Promise<ToolboxRunUserScriptResult>;

export function buildL2MinimizationSourceTransform(
  runScript: L2ScriptRunner = runL2MinimizationScriptThroughWorker,
): ViewportActionAsyncSourceTransform {
  return async (rawSource, parameterValues, onProgress, abortSignal) => {
    const source = coerceViewportSourceToRasterSource(rawSource);
    const settings = readL2MinimizationSettings(parameterValues);
    const layer = resolveRequiredMaskLayerOrThrow(settings.maskLayerId);
    const result = await runScript(source.raster, settings, layer, onProgress, abortSignal);
    // A stopped run may still settle with SOME outcome (the killed worker
    // reports a failure); the signal, not the outcome, decides "stopped".
    throwIfOperationStopped(abortSignal);
    return { kind: "raster", raster: buildL2ResultStack(source.raster, result) };
  };
}

function resolveRequiredMaskLayerOrThrow(maskLayerId: string): MaskLayer {
  if (maskLayerId === NO_MASK_LAYER_SELECTED) {
    throw new Error("Choose a mask layer before applying L2 Minimization.");
  }
  const layer = readRememberedMaskLayerOrNull(maskLayerId);
  if (!layer) {
    throw new Error("The chosen mask layer is no longer available. Choose it again and try again.");
  }
  return layer;
}

function runL2MinimizationScriptThroughWorker(
  raster: RasterImage,
  settings: L2MinimizationSettings,
  layer: MaskLayer,
  onProgress?: TransformProgressCallback,
  abortSignal?: AbortSignal,
): Promise<ToolboxRunUserScriptResult> {
  return runUserScriptOverRasterAtApply(
    raster,
    { mode: "builtin", scriptName: "l2_minimization" },
    "cube",
    onProgress,
    abortSignal,
    { masks: buildL2MaskArraysFromLayer(layer), params: buildL2ExecuteParams(settings) },
  );
}

function buildL2ResultStack(raster: RasterImage, result: ToolboxRunUserScriptResult): RasterImage {
  if (result.status !== "completed-cube") throw new Error(describeUnusableRunOutcome(result));
  const validated = validateTransformedCubeAgainstSource(
    result.shape,
    result.bands,
    raster.height,
    raster.width,
  );
  rejectResultNotMatchingSourceGrid(validated.shape, raster);
  return makeComponentStackFromProjection(
    validated.bands,
    readComponentStackSourceMeta(raster, L2_MINIMIZATION_COMPONENT_LABEL_PREFIX),
  );
}

// The script fits one linear combination per pixel, so the result is always
// one band on the source's own spatial grid; anything else means the packaged
// script and this wiring have drifted apart.
function rejectResultNotMatchingSourceGrid(
  shape: readonly [number, number, number],
  raster: RasterImage,
): void {
  const [bandCount, height, width] = shape;
  if (bandCount === 1 && height === raster.height && width === raster.width) return;
  throw new Error(
    `${L2_MINIMIZATION_LABEL} returned a ${bandCount} x ${height} x ${width} stack ` +
      `instead of one band of ${raster.height} x ${raster.width}. Please report this as a bug.`,
  );
}

function describeUnusableRunOutcome(
  result: Exclude<ToolboxRunUserScriptResult, { status: "completed-cube" }>,
): string {
  if (result.status === "failed") return result.message;
  if (result.status === "canceled") return "The run was canceled.";
  return "The algorithm did not return a stack.";
}
