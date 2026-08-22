import { USER_SCRIPT_RUN_CHUNK_BYTES } from "@shared/chunked-user-script-run-protocol";

import type { RasterImage } from "@/lib/image/raster-image";
import type { BusyEntryHandle, BusyEntryRegistrar } from "@/state/busy-state-context";

import {
  runUserScriptOverCubeInChunks,
  type ChunkedUserScriptRunCallbacks,
  type UserScriptRunChunkedApi,
  type UserScriptRunExtras,
} from "./run-user-script-chunked";
import { buildUserScriptRunCubeInputFromRaster } from "./user-script-cube";

// CT-219g: the shared entry point the three scripting editors (band weighting,
// band selection, custom transform) call for a Run formula / Import script
// click. It runs the chunked transfer over the current stack and shows a
// viewport busy entry while the run is in flight: a determinate bar while the
// cube streams to the main process, then the indeterminate spinner while the
// Python worker runs. The busy entry registers only once the run is READY
// (after the import dialog, when any), so no overlay sits behind a native
// file picker.
//
// CT-308: a built-in algorithm run adds two optional bindings - the per-run
// extras (category masks and params) and a stop controller, whose abort becomes
// the busy card's Stop button and kills the Python worker.

export interface UserScriptRunFlowBindings {
  readonly busyRegistrar: BusyEntryRegistrar;
  readonly viewportIndex: number;
  readonly extras?: UserScriptRunExtras;
  readonly stopController?: AbortController;
}

export async function runUserScriptOnRasterShowingViewportBusy(
  bindings: UserScriptRunFlowBindings,
  raster: RasterImage,
  source: ToolboxRunUserScriptSource,
  resultKind: ToolboxRunUserScriptResultKind = "value",
  api: UserScriptRunChunkedApi = window.toolboxApi,
): Promise<ToolboxRunUserScriptResult> {
  const busy: { handle: BusyEntryHandle | null } = { handle: null };
  try {
    return await runUserScriptOverCubeInChunks(
      api,
      buildUserScriptRunCubeInputFromRaster(raster),
      source,
      resultKind,
      buildRunCallbacksDrivingBusyEntry(bindings, source, busy),
      USER_SCRIPT_RUN_CHUNK_BYTES,
      bindings.extras ?? {},
    );
  } finally {
    busy.handle?.clear();
  }
}

function buildRunCallbacksDrivingBusyEntry(
  bindings: UserScriptRunFlowBindings,
  source: ToolboxRunUserScriptSource,
  busy: { handle: BusyEntryHandle | null },
): ChunkedUserScriptRunCallbacks {
  return {
    onRunReady: () => {
      busy.handle = registerViewportBusyEntryForUserScriptRun(bindings, source);
    },
    onUploadProgress: (fraction) => busy.handle?.update({ progress: fraction }),
    // CT-307: a script that reports in-script progress flips the busy entry
    // from the worker-run spinner back to the determinate bar.
    onWorkerProgress: (fraction) => busy.handle?.update({ progress: fraction }),
    abortSignal: bindings.stopController?.signal,
  };
}

function registerViewportBusyEntryForUserScriptRun(
  bindings: UserScriptRunFlowBindings,
  source: ToolboxRunUserScriptSource,
): BusyEntryHandle {
  const stopController = bindings.stopController;
  return bindings.busyRegistrar.registerViewportBusyEntry({
    viewportIndex: bindings.viewportIndex,
    label: describeUserScriptRunBusyLabel(source),
    requestStop: stopController ? () => stopController.abort() : undefined,
  });
}

// Deliberately no "on the stack": a run only stages a result (the stack
// changes on Apply), and the old wording read as if the stack was mutating.
export function describeUserScriptRunBusyLabel(source: ToolboxRunUserScriptSource): string {
  if (source.mode === "formula") return "Running formula...";
  if (source.mode === "builtin") return "Running analysis...";
  return "Running imported tool...";
}
