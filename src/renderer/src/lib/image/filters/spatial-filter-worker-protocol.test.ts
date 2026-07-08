import { describe, expect, it } from "vitest";

import {
  computeSpatialFilterWorkerResponse,
  type SpatialFilterWorkerRequest,
} from "./spatial-filter-worker-protocol";
import {
  applySpatialFrequencyFilterToBand,
  createReusableSpatialFilterGrid,
  type BandSpatialShape,
} from "./spatial-frequency-filter";

// CT-219a: the worker round-trip is proven through the in-process handler (the
// band-histogram-worker-protocol pattern), so it runs in node without spawning
// a Web Worker.

const SHAPE: BandSpatialShape = { width: 4, height: 4 };

function makeRampBand(): Uint8Array {
  return Uint8Array.from({ length: 16 }, (_unused, index) => index * 10);
}

function makeRequest(overrides: Partial<SpatialFilterWorkerRequest>): SpatialFilterWorkerRequest {
  return {
    requestId: 7,
    band: makeRampBand(),
    shape: SHAPE,
    settings: { mode: "lowpass", cutoff: 0.1 },
    ...overrides,
  };
}

describe("computeSpatialFilterWorkerResponse", () => {
  it("filters the band and echoes the request id", () => {
    const response = computeSpatialFilterWorkerResponse(
      makeRequest({}),
      createReusableSpatialFilterGrid(),
    );
    expect(response.requestId).toBe(7);
    if (response.kind !== "filtered") throw new Error("expected a filtered response");
    expect(Array.from(response.values)).toEqual(
      Array.from(
        applySpatialFrequencyFilterToBand(makeRampBand(), SHAPE, { mode: "lowpass", cutoff: 0.1 }),
      ),
    );
  });

  it("turns a filter error into a failed response instead of throwing", () => {
    const response = computeSpatialFilterWorkerResponse(
      makeRequest({ settings: { mode: "lowpass", cutoff: 0 } }),
      createReusableSpatialFilterGrid(),
    );
    expect(response.kind).toBe("failed");
    if (response.kind !== "failed") throw new Error("expected a failed response");
    expect(response.message).toMatch(/greater than 0/);
  });
});
