import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RasterImage, RasterTypedArray } from "@/lib/image/raster-image";
import {
  countPendingRasterBufferReleases,
  holdSourceBuffersWhileInUse,
  holdSourcesBuffersWhileInUse,
  queueOutgoingRasterSourceForBufferRelease,
  readRasterBufferReleaseWorkVersion,
  releaseQueuedRasterBuffersSkippingShared,
  resetRasterBufferReleaseStateForTests,
  subscribeToRasterBufferReleaseWork,
} from "@/lib/image/raster-buffer-release";
import type { ViewportImageSource } from "@/lib/webgl/texture";

function rasterWithBands(bands: ReadonlyArray<RasterTypedArray>): RasterImage {
  return {
    bandPixels: bands,
    width: 2,
    height: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: bands.length,
  };
}

function rasterSource(raster: RasterImage): ViewportImageSource {
  return { kind: "raster", raster };
}

function flushWithNothingShared(): void {
  releaseQueuedRasterBuffersSkippingShared({ liveSources: [], rememberedRasters: [] });
}

describe("raster-buffer-release", () => {
  beforeEach(() => resetRasterBufferReleaseStateForTests());

  it("detaches every band buffer of a queued raster (byteLength 0) and drains it from pending", () => {
    const raster = rasterWithBands([new Uint16Array(4), new Uint16Array(4)]);
    queueOutgoingRasterSourceForBufferRelease(rasterSource(raster));
    flushWithNothingShared();
    expect(raster.bandPixels.map((band) => band.buffer.byteLength)).toEqual([0, 0]);
    expect(countPendingRasterBufferReleases()).toBe(0);
  });

  it("never detaches a band shared by reference with a live panel raster", () => {
    const sharedBand = new Uint16Array(4);
    const outgoing = rasterWithBands([sharedBand, new Uint16Array(4)]);
    const livePanel = rasterSource(rasterWithBands([sharedBand]));
    queueOutgoingRasterSourceForBufferRelease(rasterSource(outgoing));
    releaseQueuedRasterBuffersSkippingShared({ liveSources: [livePanel], rememberedRasters: [] });
    expect(sharedBand.buffer.byteLength).toBe(8);
    expect(outgoing.bandPixels[1]!.buffer.byteLength).toBe(0);
    expect(countPendingRasterBufferReleases()).toBe(1);
  });

  it("detaches a formerly shared band once no live panel references it anymore", () => {
    const sharedBand = new Uint16Array(4);
    const outgoing = rasterWithBands([sharedBand]);
    queueOutgoingRasterSourceForBufferRelease(rasterSource(outgoing));
    releaseQueuedRasterBuffersSkippingShared({
      liveSources: [rasterSource(rasterWithBands([sharedBand]))],
      rememberedRasters: [],
    });
    flushWithNothingShared();
    expect(sharedBand.buffer.byteLength).toBe(0);
    expect(countPendingRasterBufferReleases()).toBe(0);
  });

  it("never detaches a band shared with a remembered reference raster", () => {
    const sharedBand = new Uint16Array(4);
    const outgoing = rasterWithBands([sharedBand]);
    queueOutgoingRasterSourceForBufferRelease(rasterSource(outgoing));
    releaseQueuedRasterBuffersSkippingShared({
      liveSources: [],
      rememberedRasters: [rasterWithBands([sharedBand])],
    });
    expect(sharedBand.buffer.byteLength).toBe(8);
  });

  it("never detaches a source held in use, and releases it after the hold ends", () => {
    const band = new Uint16Array(4);
    const source = rasterSource(rasterWithBands([band]));
    const releaseHold = holdSourceBuffersWhileInUse(source);
    queueOutgoingRasterSourceForBufferRelease(source);
    flushWithNothingShared();
    expect(band.buffer.byteLength).toBe(8);
    releaseHold();
    flushWithNothingShared();
    expect(band.buffer.byteLength).toBe(0);
  });

  it("holds many sources at once and releases them all with one call", () => {
    const bandA = new Uint16Array(4);
    const bandB = new Uint16Array(4);
    const sources = [rasterSource(rasterWithBands([bandA])), rasterSource(rasterWithBands([bandB]))];
    const releaseHolds = holdSourcesBuffersWhileInUse(sources);
    sources.forEach((source) => queueOutgoingRasterSourceForBufferRelease(source));
    flushWithNothingShared();
    expect([bandA.buffer.byteLength, bandB.buffer.byteLength]).toEqual([8, 8]);
    releaseHolds();
    flushWithNothingShared();
    expect([bandA.buffer.byteLength, bandB.buffer.byteLength]).toEqual([0, 0]);
  });

  it("flushes an already-detached buffer without throwing (double queue converges)", () => {
    const band = new Uint16Array(4);
    const source = rasterSource(rasterWithBands([band]));
    queueOutgoingRasterSourceForBufferRelease(source);
    flushWithNothingShared();
    queueOutgoingRasterSourceForBufferRelease(source);
    expect(() => flushWithNothingShared()).not.toThrow();
    expect(countPendingRasterBufferReleases()).toBe(0);
  });

  it("ignores non-raster sources", () => {
    queueOutgoingRasterSourceForBufferRelease({
      kind: "pixels",
      pixels: new Uint8Array(4),
      width: 1,
      height: 1,
    });
    queueOutgoingRasterSourceForBufferRelease(undefined);
    expect(countPendingRasterBufferReleases()).toBe(0);
  });

  it("settles a non-transferable SharedArrayBuffer band without touching it", () => {
    const sharedMemoryBand = new Uint16Array(new SharedArrayBuffer(8));
    const outgoing = rasterWithBands([sharedMemoryBand]);
    queueOutgoingRasterSourceForBufferRelease(rasterSource(outgoing));
    flushWithNothingShared();
    expect(sharedMemoryBand.buffer.byteLength).toBe(8);
    expect(countPendingRasterBufferReleases()).toBe(0);
  });

  it("notifies subscribers and bumps the work version on queue and on hold release", () => {
    const listener = vi.fn();
    subscribeToRasterBufferReleaseWork(listener);
    const versionBefore = readRasterBufferReleaseWorkVersion();
    queueOutgoingRasterSourceForBufferRelease(rasterSource(rasterWithBands([new Uint16Array(1)])));
    const releaseHold = holdSourceBuffersWhileInUse(rasterSource(rasterWithBands([new Uint16Array(1)])));
    releaseHold();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(readRasterBufferReleaseWorkVersion()).toBe(versionBefore + 2);
  });
});
