import { isOperationStoppedError } from "@/lib/image/operation-stop";
import type { RasterImage } from "@/lib/image/raster-image";
import {
  reportCompletedUnitAndYieldSoProgressCanPaint,
  reportMultiUnitWorkStarting,
} from "@/lib/image/unit-progress";
import type { MaskLayer } from "@/lib/masks/mask-layer";
import type { BusyEntryHandle, BusyEntryRegistrar } from "@/state/busy-state-context";

import {
  computeCnrScore,
  listCnrScoreRequestsPerBand,
  type CnrScoreRequest,
} from "./cnr-score";

// CT-320: CNR scores every band of the active stack against two mask
// categories. Unlike NPC there is no Python: the formula is a mean and a
// standard deviation, so it runs on the renderer thread. That makes the yield
// between bands the whole story - it is what lets the panel's busy entry paint
// a determinate bar and what gives its Stop button a checkpoint to throw at.

export type CnrAnalysisOutcome =
  | { readonly status: "computed"; readonly scores: ReadonlyArray<number> }
  | { readonly status: "stopped" }
  | { readonly status: "failed"; readonly message: string };

export interface CnrAnalysisRequest {
  readonly raster: RasterImage;
  readonly maskLayer: MaskLayer;
  readonly textCategoryValue: number;
  readonly backgroundCategoryValue: number;
}

export interface CnrAnalysisFlowBindings {
  readonly busyRegistrar: BusyEntryRegistrar;
  readonly viewportIndex: number;
  readonly stopController: AbortController;
}

const CNR_BUSY_LABEL = "Running analysis...";

export async function computeCnrScoresShowingPanelBusy(
  request: CnrAnalysisRequest,
  bindings: CnrAnalysisFlowBindings,
): Promise<CnrAnalysisOutcome> {
  const busy = registerCnrBusyEntry(bindings);
  try {
    const scores = await scoreEveryBandYieldingBetweenThem(request, bindings, busy);
    return { status: "computed", scores };
  } catch (error) {
    return describeCnrRunFailureOutcome(error);
  } finally {
    busy.clear();
  }
}

function registerCnrBusyEntry(bindings: CnrAnalysisFlowBindings): BusyEntryHandle {
  return bindings.busyRegistrar.registerViewportBusyEntry({
    viewportIndex: bindings.viewportIndex,
    label: CNR_BUSY_LABEL,
    requestStop: () => bindings.stopController.abort(),
  });
}

async function scoreEveryBandYieldingBetweenThem(
  request: CnrAnalysisRequest,
  bindings: CnrAnalysisFlowBindings,
  busy: BusyEntryHandle,
): Promise<ReadonlyArray<number>> {
  const bandRequests = listCnrScoreRequestsPerBand(
    request.raster,
    request.maskLayer.values,
    request.textCategoryValue,
    request.backgroundCategoryValue,
  );
  const reportProgress = (fraction: number) => busy.update({ progress: fraction });
  reportMultiUnitWorkStarting(reportProgress, bandRequests.length);
  return collectBandScores(bandRequests, reportProgress, bindings.stopController.signal);
}

async function collectBandScores(
  bandRequests: ReadonlyArray<CnrScoreRequest>,
  reportProgress: (fraction: number) => void,
  abortSignal: AbortSignal,
): Promise<ReadonlyArray<number>> {
  const scores: number[] = [];
  for (const bandRequest of bandRequests) {
    scores.push(computeCnrScore(bandRequest));
    await reportCompletedUnitAndYieldSoProgressCanPaint(
      reportProgress,
      scores.length,
      bandRequests.length,
      abortSignal,
    );
  }
  return scores;
}

function describeCnrRunFailureOutcome(error: unknown): CnrAnalysisOutcome {
  if (isOperationStoppedError(error)) return { status: "stopped" };
  return { status: "failed", message: describeCnrFailureMessage(error) };
}

const CNR_FAILED_WITHOUT_A_MESSAGE =
  "The CNR analysis did not produce a score. Please report this as a bug.";

function describeCnrFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : CNR_FAILED_WITHOUT_A_MESSAGE;
}
