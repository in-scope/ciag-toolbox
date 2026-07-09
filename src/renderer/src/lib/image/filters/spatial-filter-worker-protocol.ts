import type { RasterTypedArray } from "@/lib/image/raster-image";

import type {
  BandSpatialShape,
  ReusableSpatialFilterGrid,
  SpatialFrequencyFilterSettings,
} from "./spatial-frequency-filter";

// CT-219a: request/response contract for the spatial-filter Web Worker. One
// request filters ONE band; the client sends bands sequentially so only a
// single band is ever cloned across the thread boundary at a time (the padded
// working grid stays inside the worker). The in-process handler lives here so
// the round-trip test runs in node without spawning a worker (the
// band-histogram-worker-protocol pattern).

export interface SpatialFilterWorkerRequest {
  readonly requestId: number;
  readonly band: RasterTypedArray;
  readonly shape: BandSpatialShape;
  readonly settings: SpatialFrequencyFilterSettings;
}

// CT-225: "progress" responses stream WHILE a band is filtering (0..1 within the
// band, throttled at the source), then exactly one "filtered" or "failed"
// response settles the request.
export type SpatialFilterWorkerResponse =
  | { readonly requestId: number; readonly kind: "progress"; readonly fraction: number }
  | { readonly requestId: number; readonly kind: "filtered"; readonly values: Float32Array }
  | { readonly requestId: number; readonly kind: "failed"; readonly message: string };

export function computeSpatialFilterWorkerResponse(
  request: SpatialFilterWorkerRequest,
  reusableGrid: ReusableSpatialFilterGrid,
  onProgress?: (fraction: number) => void,
): SpatialFilterWorkerResponse {
  try {
    const values = reusableGrid.filterBand(request.band, request.shape, request.settings, onProgress);
    return { requestId: request.requestId, kind: "filtered", values };
  } catch (error) {
    return { requestId: request.requestId, kind: "failed", message: describeFilterError(error) };
  }
}

function describeFilterError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
