import type { RasterImage } from "@/lib/image/raster-image";
import type { UnitProgressCallback } from "@/lib/image/unit-progress";
import type { BusyEntryHandle, BusyEntryRegistrar } from "@/state/busy-state-context";

import {
  computeOtsuCutoffsForRasterReportingProgress,
  type ThresholdOtsuCutoffs,
} from "./otsu-cutoffs";

// CT-219d: the Auto button's click flow, extracted from the threshold editor
// so its busy and error behaviour are unit-testable. The old handler called
// the cutoff computation synchronously inside the click handler with no error
// handling: at reference scale the combined-histogram allocation threw and
// the exception vanished in the React event handler, leaving the bound fields
// silently empty. This flow shows a determinate viewport busy entry while the
// per-band sweeps run and surfaces any failure through notifyError (the
// editor passes toast.error), returning null so the caller keeps the current
// bounds untouched.

export const OTSU_AUTO_BUSY_LABEL = "Deriving Otsu cutoffs per band...";

export type ComputeOtsuCutoffs = (
  raster: RasterImage,
  onProgress?: UnitProgressCallback,
) => Promise<ThresholdOtsuCutoffs>;

export interface OtsuAutoThresholdFlowBindings {
  readonly busyRegistrar: BusyEntryRegistrar;
  readonly viewportIndex: number;
  readonly notifyError: (message: string) => void;
  readonly computeCutoffs?: ComputeOtsuCutoffs;
}

export async function deriveOtsuCutoffsShowingViewportBusyOrNotifyFailure(
  bindings: OtsuAutoThresholdFlowBindings,
  raster: RasterImage,
): Promise<ThresholdOtsuCutoffs | null> {
  const handle = registerOtsuAutoViewportBusyEntry(bindings);
  try {
    const compute = bindings.computeCutoffs ?? computeOtsuCutoffsForRasterReportingProgress;
    return await compute(raster, (fraction) => handle.update({ progress: fraction }));
  } catch (error) {
    bindings.notifyError(describeOtsuAutoThresholdFailure(error));
    return null;
  } finally {
    handle.clear();
  }
}

function registerOtsuAutoViewportBusyEntry(
  bindings: OtsuAutoThresholdFlowBindings,
): BusyEntryHandle {
  return bindings.busyRegistrar.registerViewportBusyEntry({
    viewportIndex: bindings.viewportIndex,
    label: OTSU_AUTO_BUSY_LABEL,
  });
}

export function describeOtsuAutoThresholdFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Auto threshold failed: ${message}`;
}
