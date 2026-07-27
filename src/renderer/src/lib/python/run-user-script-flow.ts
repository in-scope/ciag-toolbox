import type { RasterImage } from "@/lib/image/raster-image";
import type { BusyEntryHandle, BusyEntryRegistrar } from "@/state/busy-state-context";

import {
  runUserScriptOverCubeInChunks,
  type UserScriptRunChunkedApi,
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

export interface UserScriptRunFlowBindings {
  readonly busyRegistrar: BusyEntryRegistrar;
  readonly viewportIndex: number;
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
    return await runUserScriptOverCubeInChunks(api, buildUserScriptRunCubeInputFromRaster(raster), source, resultKind, {
      onRunReady: () => {
        busy.handle = registerViewportBusyEntryForUserScriptRun(bindings, source);
      },
      onUploadProgress: (fraction) => busy.handle?.update({ progress: fraction }),
    });
  } finally {
    busy.handle?.clear();
  }
}

function registerViewportBusyEntryForUserScriptRun(
  bindings: UserScriptRunFlowBindings,
  source: ToolboxRunUserScriptSource,
): BusyEntryHandle {
  return bindings.busyRegistrar.registerViewportBusyEntry({
    viewportIndex: bindings.viewportIndex,
    label: describeUserScriptRunBusyLabel(source),
  });
}

// Deliberately no "on the stack": a run only stages a result (the stack
// changes on Apply), and the old wording read as if the stack was mutating.
export function describeUserScriptRunBusyLabel(source: ToolboxRunUserScriptSource): string {
  return source.mode === "formula" ? "Running formula..." : "Running imported tool...";
}
