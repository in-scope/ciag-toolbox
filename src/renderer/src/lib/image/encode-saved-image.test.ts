import { describe, expect, it } from "vitest";

import { encodeViewportSourceForSaving } from "@/lib/image/encode-saved-image";
import type { RasterImage } from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

// CT-219f: the save encode threads onProgress into the chunked TIFF and ENVI encoders
// so the app save busy entry renders a determinate percentage bar.
describe("encodeViewportSourceForSaving progress reporting", () => {
  it("reports monotonic 0..1 progress for a TIFF export", async () => {
    const fractions: number[] = [];
    const encoded = await encodeViewportSourceForSaving({
      source: buildRasterSource(),
      selectedBandIndex: 0,
      formatId: "tiff-16-bit",
      onProgress: (fraction) => fractions.push(fraction),
    });
    expect(encoded.bytes.length).toBeGreaterThan(0);
    expectMonotonicFractionsEndingAtOne(fractions);
  });

  it("reports monotonic 0..1 progress for an ENVI export", async () => {
    const fractions: number[] = [];
    const encoded = await encodeViewportSourceForSaving({
      source: buildRasterSource(),
      selectedBandIndex: 0,
      formatId: "envi",
      onProgress: (fraction) => fractions.push(fraction),
    });
    expect(encoded.sidecar?.bytes.length).toBeGreaterThan(0);
    expectMonotonicFractionsEndingAtOne(fractions);
  });

  it("reports monotonic 0..1 progress for a float ENVI export of an integer stack", async () => {
    const fractions: number[] = [];
    await encodeViewportSourceForSaving({
      source: buildRasterSource(),
      selectedBandIndex: 0,
      formatId: "envi-float",
      onProgress: (fraction) => fractions.push(fraction),
    });
    expectMonotonicFractionsEndingAtOne(fractions);
  });
});

function expectMonotonicFractionsEndingAtOne(fractions: ReadonlyArray<number>): void {
  expect(fractions.length).toBeGreaterThan(0);
  const sorted = [...fractions].sort((a, b) => a - b);
  expect(fractions).toEqual(sorted);
  expect(fractions.at(-1)).toBe(1);
}

function buildRasterSource(): ViewportImageSource {
  const raster: RasterImage = {
    width: 3,
    height: 2,
    bandCount: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandPixels: [
      new Uint16Array([10, 20, 30, 40, 50, 60]),
      new Uint16Array([110, 120, 130, 140, 150, 160]),
    ],
  };
  return { kind: "raster", raster };
}
