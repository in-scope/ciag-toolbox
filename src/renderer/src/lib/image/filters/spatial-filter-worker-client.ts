import { OperationStoppedError } from "@/lib/image/operation-stop";
import type { RasterTypedArray } from "@/lib/image/raster-image";
import {
  reportCompletedUnitAndYieldSoProgressCanPaint,
  reportMultiUnitWorkStarting,
  type UnitProgressCallback,
} from "@/lib/image/unit-progress";

import type {
  BandSpatialShape,
  SpatialFrequencyFilterSettings,
} from "./spatial-frequency-filter";
import type {
  SpatialFilterWorkerRequest,
  SpatialFilterWorkerResponse,
} from "./spatial-filter-worker-protocol";

// CT-219a: runs the spatial filter's FFT loop on a dedicated Web Worker so a
// large stack no longer freezes the UI thread. Bands go through one at a time
// (a single band is the peak structured-clone cost; the worker reuses one
// padded grid across the batch) and the worker is terminated in finally so its
// grid memory is always released.

export interface SpatialFilterBandInput {
  readonly bandIndex: number;
  readonly pixels: RasterTypedArray;
}

export function isSpatialFilterWorkerAvailable(): boolean {
  return typeof Worker !== "undefined";
}

// CT-268: an abort rejects the in-flight band promise with OperationStoppedError;
// the finally then terminates the worker, which kills the FFT loop mid-band and
// releases the worker's grid memory.
export async function filterBandsOnDedicatedSpatialFilterWorker(
  bands: ReadonlyArray<SpatialFilterBandInput>,
  shape: BandSpatialShape,
  settings: SpatialFrequencyFilterSettings,
  onProgress?: UnitProgressCallback,
  abortSignal?: AbortSignal,
): Promise<Map<number, Float32Array>> {
  const worker = spawnSpatialFilterWorker();
  try {
    return await filterEachBandSequentially(worker, bands, shape, settings, onProgress, abortSignal);
  } finally {
    worker.terminate();
  }
}

function spawnSpatialFilterWorker(): Worker {
  return new Worker(new URL("./spatial-filter-worker.ts", import.meta.url), {
    type: "module",
  });
}

// CT-225: within-band progress folds into the overall fraction as
// (completed bands + within-band fraction) / bands to filter, so a minutes-long
// band advances the bar continuously instead of jumping once per band.
async function filterEachBandSequentially(
  worker: Worker,
  bands: ReadonlyArray<SpatialFilterBandInput>,
  shape: BandSpatialShape,
  settings: SpatialFrequencyFilterSettings,
  onProgress?: UnitProgressCallback,
  abortSignal?: AbortSignal,
): Promise<Map<number, Float32Array>> {
  const filteredByBandIndex = new Map<number, Float32Array>();
  reportMultiUnitWorkStarting(onProgress, bands.length);
  for (const [requestId, band] of bands.entries()) {
    const request = { requestId, band: band.pixels, shape, settings };
    const onWithinBandProgress = (fraction: number): void =>
      onProgress?.((requestId + fraction) / bands.length);
    filteredByBandIndex.set(
      band.bandIndex,
      await requestSingleBandFilter(worker, request, onWithinBandProgress, abortSignal),
    );
    await reportCompletedUnitAndYieldSoProgressCanPaint(onProgress, requestId + 1, bands.length, abortSignal);
  }
  return filteredByBandIndex;
}

function requestSingleBandFilter(
  worker: Worker,
  request: SpatialFilterWorkerRequest,
  onWithinBandProgress: UnitProgressCallback,
  abortSignal?: AbortSignal,
): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const rejectBecauseStopped = (): void => reject(new OperationStoppedError());
    if (abortSignal?.aborted) return rejectBecauseStopped();
    abortSignal?.addEventListener("abort", rejectBecauseStopped, { once: true });
    const settleRemovingStopListener = wrapSettlersToRemoveStopListener(resolve, reject, abortSignal, rejectBecauseStopped);
    worker.onmessage = (event: MessageEvent<SpatialFilterWorkerResponse>) =>
      settleSingleBandFilter(event.data, request.requestId, settleRemovingStopListener.resolve, settleRemovingStopListener.reject, onWithinBandProgress);
    worker.onerror = (event) => settleRemovingStopListener.reject(new Error(event.message || "Spatial filter worker failed"));
    worker.postMessage(request);
  });
}

// Each band adds one abort listener; removing it when the band settles keeps a
// long-lived signal from accumulating one listener per filtered band.
function wrapSettlersToRemoveStopListener(
  resolve: (values: Float32Array) => void,
  reject: (reason: Error) => void,
  abortSignal: AbortSignal | undefined,
  stopListener: () => void,
): { resolve: (values: Float32Array) => void; reject: (reason: Error) => void } {
  const removeStopListener = (): void => abortSignal?.removeEventListener("abort", stopListener);
  return {
    resolve: (values) => {
      removeStopListener();
      resolve(values);
    },
    reject: (reason) => {
      removeStopListener();
      reject(reason);
    },
  };
}

function settleSingleBandFilter(
  response: SpatialFilterWorkerResponse,
  expectedRequestId: number,
  resolve: (values: Float32Array) => void,
  reject: (reason: Error) => void,
  onWithinBandProgress: UnitProgressCallback,
): void {
  if (response.requestId !== expectedRequestId) return;
  if (response.kind === "progress") {
    onWithinBandProgress(response.fraction);
    return;
  }
  if (response.kind === "filtered") {
    resolve(response.values);
    return;
  }
  reject(new Error(response.message));
}
