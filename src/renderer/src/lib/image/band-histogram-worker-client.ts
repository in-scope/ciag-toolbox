import type { BandHistogram } from "@/lib/image/compute-band-histogram";
import type {
  BandHistogramWorkerRequest,
  BandHistogramWorkerResponse,
} from "@/lib/image/band-histogram-worker-protocol";
import {
  getRasterBandPixelsOrThrow,
  type RasterImage,
} from "@/lib/image/raster-image";

export interface ComputeBandHistogramOnWorkerInputs {
  readonly raster: RasterImage;
  readonly bandIndex: number;
  readonly binCount: number;
}

export interface BandHistogramWorkerClient {
  readonly computeBandHistogramOnWorker: (
    inputs: ComputeBandHistogramOnWorkerInputs,
  ) => Promise<BandHistogram>;
  readonly dispose: () => void;
}

interface InflightHistogramRequest {
  readonly requestId: number;
  readonly resolve: (histogram: BandHistogram) => void;
  readonly reject: (reason: unknown) => void;
}

export function createBandHistogramWorkerClient(): BandHistogramWorkerClient {
  const worker = spawnBandHistogramWorker();
  const requestState = createBandHistogramRequestState();
  worker.onmessage = (event: MessageEvent<BandHistogramWorkerResponse>) =>
    handleBandHistogramWorkerMessage(event.data, requestState);
  return {
    computeBandHistogramOnWorker: (inputs) =>
      enqueueBandHistogramRequest(worker, requestState, inputs),
    dispose: () => disposeBandHistogramWorkerClient(worker, requestState),
  };
}

function spawnBandHistogramWorker(): Worker {
  return new Worker(new URL("./band-histogram-worker.ts", import.meta.url), {
    type: "module",
  });
}

interface BandHistogramRequestState {
  nextRequestId: number;
  latestRequestId: number;
  readonly pendingByRequestId: Map<number, InflightHistogramRequest>;
}

function createBandHistogramRequestState(): BandHistogramRequestState {
  return { nextRequestId: 0, latestRequestId: 0, pendingByRequestId: new Map() };
}

function enqueueBandHistogramRequest(
  worker: Worker,
  state: BandHistogramRequestState,
  inputs: ComputeBandHistogramOnWorkerInputs,
): Promise<BandHistogram> {
  abandonInflightHistogramRequests(state);
  const requestId = pickNextHistogramRequestId(state);
  const message = buildBandHistogramRequestMessage(requestId, inputs);
  return new Promise<BandHistogram>((resolve, reject) => {
    state.pendingByRequestId.set(requestId, { requestId, resolve, reject });
    worker.postMessage(message);
  });
}

function abandonInflightHistogramRequests(state: BandHistogramRequestState): void {
  for (const inflight of state.pendingByRequestId.values()) {
    inflight.reject(new BandHistogramRequestAbandonedError());
  }
  state.pendingByRequestId.clear();
}

function pickNextHistogramRequestId(state: BandHistogramRequestState): number {
  state.nextRequestId += 1;
  state.latestRequestId = state.nextRequestId;
  return state.nextRequestId;
}

function buildBandHistogramRequestMessage(
  requestId: number,
  inputs: ComputeBandHistogramOnWorkerInputs,
): BandHistogramWorkerRequest {
  return {
    requestId,
    pixels: getRasterBandPixelsOrThrow(inputs.raster, inputs.bandIndex),
    sampleFormat: inputs.raster.sampleFormat,
    bitsPerSample: inputs.raster.bitsPerSample,
    binCount: inputs.binCount,
  };
}

function handleBandHistogramWorkerMessage(
  response: BandHistogramWorkerResponse,
  state: BandHistogramRequestState,
): void {
  const inflight = state.pendingByRequestId.get(response.requestId);
  if (!inflight) return;
  state.pendingByRequestId.delete(response.requestId);
  inflight.resolve(response.histogram);
}

function disposeBandHistogramWorkerClient(
  worker: Worker,
  state: BandHistogramRequestState,
): void {
  abandonInflightHistogramRequests(state);
  worker.terminate();
}

export class BandHistogramRequestAbandonedError extends Error {
  constructor() {
    super("Band histogram request abandoned (superseded by a newer request)");
    this.name = "BandHistogramRequestAbandonedError";
  }
}

export function isBandHistogramRequestAbandonedError(value: unknown): boolean {
  return value instanceof BandHistogramRequestAbandonedError;
}
