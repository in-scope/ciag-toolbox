import type { RasterImage } from "@/lib/image/raster-image";
import { makeFloat32RasterFromBands } from "@/lib/image/make-float-raster";
import { isOperationStoppedError } from "@/lib/image/operation-stop";
import { describeScriptErrorWithDocsHint } from "@/lib/image/band-ops/user-script-return-contract";
import { describeElectronInvokeFailure } from "@/lib/ipc/electron-invoke-error";
import type { MaskLayer } from "@/lib/masks/mask-layer";
import {
  openUserScriptRunSessionOverCube,
  type ChunkedUserScriptRunCallbacks,
  type UserScriptRunChunkedApi,
  type UserScriptRunSession,
} from "@/lib/python/run-user-script-chunked";
import {
  runUserScriptOnRasterShowingViewportBusy,
  type UserScriptRunFlowBindings,
} from "@/lib/python/run-user-script-flow";
import { buildUserScriptRunCubeInputFromRaster } from "@/lib/python/user-script-cube";
import type { BusyEntryHandle } from "@/state/busy-state-context";

import { computeNpcScoreShowingPanelBusy } from "./run-npc-analysis";
import { DEFAULT_NPC_BIN_COUNT, buildNpcCategoryMasks } from "./npc-run-request";
import { computeCnrScore } from "./cnr-score";
import { buildRopExecuteParams } from "./rop-run-request";
import type { RopCustomObjectiveScript, RopObjectiveKind } from "./rop-objective";

// CT-309: the ROP panel's run flows. The source cube uploads ONCE into a
// retained run session; every "New projection" press re-executes the built-in
// rop.py against that spool with a fresh seed, so presses after the first move
// no cube bytes. Scoring reuses the one-shot flows: NPC runs the built-in
// script over the candidate, CNR is computed in TS from the candidate values,
// and a custom script receives the candidate as its cube with the mask
// categories in params.

const ROP_BUILTIN_SOURCE: ToolboxRunUserScriptSource = { mode: "builtin", scriptName: "rop" };
const ROP_RUN_BUSY_LABEL = "Running analysis...";

const ROP_RETURNED_NO_CANDIDATE =
  "The ROP run did not return a projection. Please report this as a bug.";
const CUSTOM_OBJECTIVE_NEEDS_ONE_FINITE_NUMBER =
  "The objective script must return one finite number.";

export type RopRollOutcome =
  | { readonly status: "rolled"; readonly values: Float32Array }
  | { readonly status: "stopped" }
  | { readonly status: "failed"; readonly message: string };

// One holder per (panel, raster): it lazily opens the retained session on the
// first press and must be released when the panel closes or the stack changes.
export interface RopProjectionSessionHolder {
  executeProjectionShowingPanelBusy(
    seed: number,
    bindings: UserScriptRunFlowBindings,
  ): Promise<RopRollOutcome>;
  release(): Promise<void>;
}

export function createRopProjectionSessionHolder(
  raster: RasterImage,
  api: UserScriptRunChunkedApi = window.toolboxApi,
): RopProjectionSessionHolder {
  const holder: { session: UserScriptRunSession | null } = { session: null };
  return {
    executeProjectionShowingPanelBusy: (seed, bindings) =>
      rollProjectionShowingPanelBusy(holder, raster, seed, bindings, api),
    release: async () => {
      await holder.session?.release();
      holder.session = null;
    },
  };
}

async function rollProjectionShowingPanelBusy(
  holder: { session: UserScriptRunSession | null },
  raster: RasterImage,
  seed: number,
  bindings: UserScriptRunFlowBindings,
  api: UserScriptRunChunkedApi,
): Promise<RopRollOutcome> {
  const busy = registerRopRunBusyEntry(bindings);
  try {
    return await rollProjectionUpdatingBusyEntry(holder, raster, seed, bindings, api, busy);
  } catch (error) {
    return describeRopRollFailureOutcome(error);
  } finally {
    busy.clear();
  }
}

function registerRopRunBusyEntry(bindings: UserScriptRunFlowBindings): BusyEntryHandle {
  const stopController = bindings.stopController;
  return bindings.busyRegistrar.registerViewportBusyEntry({
    viewportIndex: bindings.viewportIndex,
    label: ROP_RUN_BUSY_LABEL,
    requestStop: stopController ? () => stopController.abort() : undefined,
  });
}

async function rollProjectionUpdatingBusyEntry(
  holder: { session: UserScriptRunSession | null },
  raster: RasterImage,
  seed: number,
  bindings: UserScriptRunFlowBindings,
  api: UserScriptRunChunkedApi,
  busy: BusyEntryHandle,
): Promise<RopRollOutcome> {
  const callbacks = buildRunCallbacksForBusyEntry(bindings, busy);
  const session = await openRetainedRopSessionIfNeeded(holder, raster, api, callbacks);
  if (session === null) return { status: "stopped" };
  const result = await session.execute(buildRopExecuteParams(seed), callbacks);
  return describeRopRollOutcome(result);
}

function buildRunCallbacksForBusyEntry(
  bindings: UserScriptRunFlowBindings,
  busy: BusyEntryHandle,
): ChunkedUserScriptRunCallbacks {
  return {
    onUploadProgress: (fraction) => busy.update({ progress: fraction }),
    onWorkerProgress: (fraction) => busy.update({ progress: fraction }),
    abortSignal: bindings.stopController?.signal,
  };
}

// A canceled begin maps to "stopped" (nothing to report); a failed begin throws
// so the shared failure mapping renders the message.
async function openRetainedRopSessionIfNeeded(
  holder: { session: UserScriptRunSession | null },
  raster: RasterImage,
  api: UserScriptRunChunkedApi,
  callbacks: ChunkedUserScriptRunCallbacks,
): Promise<UserScriptRunSession | null> {
  if (holder.session !== null) return holder.session;
  const opened = await openUserScriptRunSessionOverCube(
    api,
    buildUserScriptRunCubeInputFromRaster(raster),
    ROP_BUILTIN_SOURCE,
    "cube",
    callbacks,
  );
  if (opened.status === "canceled") return null;
  if (opened.status === "failed") throw new Error(opened.message);
  holder.session = opened.session;
  return opened.session;
}

function describeRopRollOutcome(result: ToolboxRunUserScriptResult): RopRollOutcome {
  if (result.status === "canceled") return { status: "stopped" };
  if (result.status === "failed") return { status: "failed", message: result.message };
  if (result.status === "completed-cube" && result.bands[0] !== undefined) {
    return { status: "rolled", values: result.bands[0] };
  }
  return { status: "failed", message: ROP_RETURNED_NO_CANDIDATE };
}

function describeRopRollFailureOutcome(error: unknown): RopRollOutcome {
  if (isOperationStoppedError(error)) return { status: "stopped" };
  return { status: "failed", message: describeElectronInvokeFailure(error) };
}

// --- Candidate scoring -------------------------------------------------------

export type RopScoreOutcome =
  | { readonly status: "scored"; readonly score: number }
  | { readonly status: "stopped" }
  | { readonly status: "failed"; readonly message: string };

export interface RopScoreRequest {
  readonly candidateValues: Float32Array;
  readonly width: number;
  readonly height: number;
  readonly objectiveKind: Exclude<RopObjectiveKind, "none">;
  readonly maskLayer: MaskLayer | null;
  readonly cnrTextCategoryValue: number | null;
  readonly cnrBackgroundCategoryValue: number | null;
  readonly customScript: RopCustomObjectiveScript | null;
}

export async function scoreRopCandidateShowingPanelBusy(
  request: RopScoreRequest,
  bindings: UserScriptRunFlowBindings,
  api?: UserScriptRunChunkedApi,
): Promise<RopScoreOutcome> {
  if (request.objectiveKind === "cnr") return scoreCandidateWithCnrFormula(request);
  if (request.objectiveKind === "npc") {
    return scoreCandidateWithBuiltinNpc(request, bindings, api);
  }
  return scoreCandidateWithCustomScript(request, bindings, api);
}

// The candidate rides as a one-band cube for the script-based objectives; the
// panel keeps the returned values, so wrapping them costs no copy.
function buildCandidateRasterFromRequest(request: RopScoreRequest): RasterImage {
  return makeFloat32RasterFromBands(
    { width: request.width, height: request.height },
    [request.candidateValues],
  );
}

function scoreCandidateWithCnrFormula(request: RopScoreRequest): RopScoreOutcome {
  const { maskLayer, cnrTextCategoryValue, cnrBackgroundCategoryValue } = request;
  if (maskLayer === null || cnrTextCategoryValue === null || cnrBackgroundCategoryValue === null) {
    return { status: "failed", message: "CNR needs a text and a background category." };
  }
  return computeFiniteCnrScoreOutcome({
    candidateValues: request.candidateValues,
    maskValues: maskLayer.values,
    textCategoryValue: cnrTextCategoryValue,
    backgroundCategoryValue: cnrBackgroundCategoryValue,
  });
}

function computeFiniteCnrScoreOutcome(cnrRequest: Parameters<typeof computeCnrScore>[0]): RopScoreOutcome {
  try {
    const score = computeCnrScore(cnrRequest);
    return describeFiniteScoreOutcome(score, "The CNR score is not a finite number.");
  } catch (error) {
    return { status: "failed", message: error instanceof Error ? error.message : String(error) };
  }
}

function describeFiniteScoreOutcome(score: number, notFiniteMessage: string): RopScoreOutcome {
  if (!Number.isFinite(score)) return { status: "failed", message: notFiniteMessage };
  return { status: "scored", score };
}

async function scoreCandidateWithBuiltinNpc(
  request: RopScoreRequest,
  bindings: UserScriptRunFlowBindings,
  api?: UserScriptRunChunkedApi,
): Promise<RopScoreOutcome> {
  if (request.maskLayer === null) {
    return { status: "failed", message: "NPC needs a qualifying mask layer." };
  }
  const outcome = await computeNpcScoreShowingPanelBusy(
    {
      raster: buildCandidateRasterFromRequest(request),
      maskLayer: request.maskLayer,
      bins: DEFAULT_NPC_BIN_COUNT,
    },
    bindings,
    api,
  );
  if (outcome.status === "computed") return { status: "scored", score: outcome.score };
  return outcome;
}

// The custom objective contract: run(cube, wavelengths, params) receives the
// candidate as its cube and the mask categories in params, and must return one
// finite number. Failures carry the scripting-docs pointer.
async function scoreCandidateWithCustomScript(
  request: RopScoreRequest,
  bindings: UserScriptRunFlowBindings,
  api?: UserScriptRunChunkedApi,
): Promise<RopScoreOutcome> {
  if (request.customScript === null) {
    return { status: "failed", message: "Import an objective script first." };
  }
  const result = await runCustomObjectiveScriptOverCandidate(request, request.customScript, bindings, api);
  return describeCustomObjectiveOutcome(result);
}

function runCustomObjectiveScriptOverCandidate(
  request: RopScoreRequest,
  customScript: RopCustomObjectiveScript,
  bindings: UserScriptRunFlowBindings,
  api?: UserScriptRunChunkedApi,
): Promise<ToolboxRunUserScriptResult> {
  return runUserScriptOnRasterShowingViewportBusy(
    { ...bindings, extras: { masks: buildCustomObjectiveMasks(request.maskLayer) } },
    buildCandidateRasterFromRequest(request),
    { mode: "import", scriptPath: customScript.filePath },
    "value",
    api ?? window.toolboxApi,
  );
}

function buildCustomObjectiveMasks(maskLayer: MaskLayer | null): Uint8Array[] {
  return maskLayer === null ? [] : buildNpcCategoryMasks(maskLayer);
}

function describeCustomObjectiveOutcome(result: ToolboxRunUserScriptResult): RopScoreOutcome {
  if (result.status === "canceled") return { status: "stopped" };
  if (result.status === "failed") {
    return { status: "failed", message: describeScriptErrorWithDocsHint(result.message) };
  }
  if (result.status === "completed" && typeof result.value === "number") {
    return describeFiniteScoreOutcome(
      result.value,
      describeScriptErrorWithDocsHint(CUSTOM_OBJECTIVE_NEEDS_ONE_FINITE_NUMBER),
    );
  }
  return {
    status: "failed",
    message: describeScriptErrorWithDocsHint(CUSTOM_OBJECTIVE_NEEDS_ONE_FINITE_NUMBER),
  };
}
