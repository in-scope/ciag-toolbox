import type { RasterImage } from "@/lib/image/raster-image";
import { isOperationStoppedError } from "@/lib/image/operation-stop";
import { describeElectronInvokeFailure } from "@/lib/ipc/electron-invoke-error";
import type { UserScriptRunChunkedApi } from "@/lib/python/run-user-script-chunked";
import {
  runUserScriptOnRasterShowingViewportBusy,
  type UserScriptRunFlowBindings,
} from "@/lib/python/run-user-script-flow";

import { buildRopSearchRunExtras, type RopSearchRunRequest } from "./rop-search-request";

// CT-310: the optimization search. Where a press runs one projection, this is
// ONE built-in run whose Python loop draws every candidate, scores it with the
// chosen objective, and returns only the winning band - so ten thousand
// candidates cost one worker spawn, one cube upload, and one band of memory.
// The determinate bar comes from the script's own progress reports, and Stop
// kills the worker, which surfaces here as "stopped" with nothing delivered.

const ROP_SEARCH_BUILTIN_SOURCE: ToolboxRunUserScriptSource = {
  mode: "builtin",
  scriptName: "rop_search",
};

const SEARCH_RETURNED_NO_PROJECTION =
  "The projection search did not return a projection. Please report this as a bug.";

export type RopSearchOutcome =
  | { readonly status: "searched"; readonly values: Float32Array }
  | { readonly status: "stopped" }
  | { readonly status: "failed"; readonly message: string };

export async function searchBestRopProjectionShowingPanelBusy(
  request: RopSearchRunRequest,
  raster: RasterImage,
  bindings: UserScriptRunFlowBindings,
  api?: UserScriptRunChunkedApi,
): Promise<RopSearchOutcome> {
  try {
    return describeRopSearchOutcome(await runSearchOverRaster(request, raster, bindings, api));
  } catch (error) {
    return describeRopSearchFailureOutcome(error);
  }
}

function runSearchOverRaster(
  request: RopSearchRunRequest,
  raster: RasterImage,
  bindings: UserScriptRunFlowBindings,
  api?: UserScriptRunChunkedApi,
): Promise<ToolboxRunUserScriptResult> {
  return runUserScriptOnRasterShowingViewportBusy(
    { ...bindings, extras: buildRopSearchRunExtras(request) },
    raster,
    ROP_SEARCH_BUILTIN_SOURCE,
    "cube",
    api ?? window.toolboxApi,
  );
}

function describeRopSearchOutcome(result: ToolboxRunUserScriptResult): RopSearchOutcome {
  if (result.status === "canceled") return { status: "stopped" };
  if (result.status === "failed") return { status: "failed", message: result.message };
  if (result.status === "completed-cube" && result.bands[0] !== undefined) {
    return { status: "searched", values: result.bands[0] };
  }
  return { status: "failed", message: SEARCH_RETURNED_NO_PROJECTION };
}

function describeRopSearchFailureOutcome(error: unknown): RopSearchOutcome {
  if (isOperationStoppedError(error)) return { status: "stopped" };
  return { status: "failed", message: describeElectronInvokeFailure(error) };
}
