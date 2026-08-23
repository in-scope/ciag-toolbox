import type { BuiltinScriptName } from "@shared/chunked-user-script-run-protocol";

import { validateTransformedCubeAgainstSource } from "@/lib/image/band-ops/cube-transform-contract";
import {
  makeComponentStackFromProjection,
  readComponentStackSourceMeta,
} from "@/lib/image/dimension-reduction/transform-output";
import { throwIfOperationStopped } from "@/lib/image/operation-stop";
import { coerceViewportSourceToRasterSource } from "@/lib/image/promote-source-to-raster";
import type { RasterImage } from "@/lib/image/raster-image";
import { runUserScriptOverRasterAtApply } from "@/lib/python/run-user-script-at-apply";

import {
  buildLocalProjectionExecuteParams,
  buildLocalProjectionParameterSchemas,
  formatLocalProjectionAppliedLabel,
  readLocalProjectionSettings,
  type LocalProjectionSettings,
} from "./local-projection-params";
import type { RegisteredActionIcon, RegisteredViewportAction } from "./registered-actions";
import type {
  TransformProgressCallback,
  ViewportActionAsyncSourceTransform,
} from "./viewport-action";

// CT-311: the shared foundation behind the spatially adaptive projections that
// run the client's own Python as packaged built-in scripts (Local PCA now,
// Local MNF next). Each supplies only its script name, label, icon and band
// label prefix; this wires the shared stride / kernel radius / mean-centring
// controls, the at-Apply worker run with its determinate in-script progress and
// working Stop, and the one-band float32 component stack the run returns.
// There is no ROI scope: the algorithms fit locally over the whole cube.

export interface LocalProjectionActionConfig {
  readonly id: string;
  readonly label: string;
  readonly icon: RegisteredActionIcon;
  readonly scriptName: BuiltinScriptName;
  readonly componentLabelPrefix: string;
  readonly successMessage: string;
  readonly loadingMessage: string;
}

export type LocalProjectionScriptRunner = (
  scriptName: BuiltinScriptName,
  raster: RasterImage,
  settings: LocalProjectionSettings,
  onProgress?: TransformProgressCallback,
  abortSignal?: AbortSignal,
) => Promise<ToolboxRunUserScriptResult>;

export function registerLocalProjectionAction(
  config: LocalProjectionActionConfig,
): RegisteredViewportAction {
  return {
    id: config.id,
    label: config.label,
    icon: config.icon,
    parameters: buildLocalProjectionParameterSchemas(config.label),
    successMessage: config.successMessage,
    appliedLabel: config.label,
    loadingMessage: config.loadingMessage,
    formatAppliedLabel: (values) => formatLocalProjectionAppliedLabel(config.label, values),
    apply: (state) => state,
    supportsStopDuringApply: true,
    transformSourceAsync: buildLocalProjectionSourceTransform(config),
  };
}

export function buildLocalProjectionSourceTransform(
  config: LocalProjectionActionConfig,
  runScript: LocalProjectionScriptRunner = runLocalProjectionScriptThroughWorker,
): ViewportActionAsyncSourceTransform {
  return async (rawSource, parameterValues, onProgress, abortSignal) => {
    const source = coerceViewportSourceToRasterSource(rawSource);
    const settings = readLocalProjectionSettings(parameterValues);
    const result = await runScript(config.scriptName, source.raster, settings, onProgress, abortSignal);
    // A stopped run may still settle with SOME outcome (the killed worker
    // reports a failure); the signal, not the outcome, decides "stopped".
    throwIfOperationStopped(abortSignal);
    return { kind: "raster", raster: buildProjectionStack(config, source.raster, result) };
  };
}

function runLocalProjectionScriptThroughWorker(
  scriptName: BuiltinScriptName,
  raster: RasterImage,
  settings: LocalProjectionSettings,
  onProgress?: TransformProgressCallback,
  abortSignal?: AbortSignal,
): Promise<ToolboxRunUserScriptResult> {
  return runUserScriptOverRasterAtApply(
    raster,
    { mode: "builtin", scriptName },
    "cube",
    onProgress,
    abortSignal,
    { params: buildLocalProjectionExecuteParams(settings) },
  );
}

function buildProjectionStack(
  config: LocalProjectionActionConfig,
  raster: RasterImage,
  result: ToolboxRunUserScriptResult,
): RasterImage {
  if (result.status !== "completed-cube") throw new Error(describeUnusableRunOutcome(result));
  const validated = validateTransformedCubeAgainstSource(
    result.shape,
    result.bands,
    raster.height,
    raster.width,
  );
  rejectProjectionNotMatchingSourceGrid(config.label, validated.shape, raster);
  return makeComponentStackFromProjection(
    validated.bands,
    readComponentStackSourceMeta(raster, config.componentLabelPrefix),
  );
}

// The algorithms project every pixel onto one local component, so the result is
// always one band on the source's own spatial grid; anything else means the
// packaged script and this wiring have drifted apart.
function rejectProjectionNotMatchingSourceGrid(
  operationLabel: string,
  shape: readonly [number, number, number],
  raster: RasterImage,
): void {
  const [bandCount, height, width] = shape;
  if (bandCount === 1 && height === raster.height && width === raster.width) return;
  throw new Error(
    `${operationLabel} returned a ${bandCount} x ${height} x ${width} stack ` +
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
