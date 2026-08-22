import type { RasterImage } from "@/lib/image/raster-image";
import type { UnitProgressCallback } from "@/lib/image/unit-progress";

import { runUserScriptOverCubeInChunks } from "./run-user-script-chunked";
import { buildUserScriptRunCubeInputFromRaster } from "./user-script-cube";

// CT-293: the shared entry point for the operations whose Python runs AT APPLY
// (the custom transform's cube result and the band-selection function's single
// band). It streams the stack up through the chunked protocol, reports the
// upload fraction as apply progress, and threads the apply flow's Stop signal
// through so an abort kills the Python subprocess (CT-268).

export type ApplyTimeUserScriptRunner = (
  raster: RasterImage,
  source: ToolboxRunUserScriptSource,
  onProgress?: UnitProgressCallback,
  abortSignal?: AbortSignal,
) => Promise<ToolboxRunUserScriptResult>;

export function runUserScriptOverRasterAtApply(
  raster: RasterImage,
  source: ToolboxRunUserScriptSource,
  resultKind: ToolboxRunUserScriptResultKind,
  onProgress?: UnitProgressCallback,
  abortSignal?: AbortSignal,
): Promise<ToolboxRunUserScriptResult> {
  return runUserScriptOverCubeInChunks(
    window.toolboxApi,
    buildUserScriptRunCubeInputFromRaster(raster),
    source,
    resultKind,
    {
      onUploadProgress: (fraction) => reportUploadFractionAsApplyProgress(fraction, onProgress),
      // CT-307: a script that reports in-script progress drives the apply bar
      // through the worker-run phase too.
      onWorkerProgress: (fraction) => onProgress?.(fraction),
      abortSignal,
    },
  );
}

// The upload fraction is determinate; the worker-run phase otherwise reports
// nothing, so the busy bar holds at the uploaded fraction while the Python
// executes (unless the script reports in-script progress, CT-307).
function reportUploadFractionAsApplyProgress(
  fraction: number | null,
  onProgress: UnitProgressCallback | undefined,
): void {
  if (fraction !== null) onProgress?.(fraction);
}
