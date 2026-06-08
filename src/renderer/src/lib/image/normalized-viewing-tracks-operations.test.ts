import { describe, expect, it } from "vitest";

import { applyBitShiftToRasterImage } from "@/lib/image/apply-bit-shift";
import { applyBandKeepToRasterImage } from "@/lib/image/apply-band-keep";
import { computeImageRgbChannelExtents } from "@/lib/image/compute-image-channel-extents";
import type { RasterImage } from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

// CT-071 regression cover: "Normalized viewing" reads the band-wise min/max that
// drives the contrast stretch from computeImageRgbChannelExtents(source, band).
// The renderer recomputes this every time it (re)builds the texture for a source,
// so the stretch must follow the CURRENT post-operation pixels, not the pixels of
// the raster that was first opened. These tests lock the displayed normalization
// range to the current data across Bit Shift and Keep Bands.

const UINT16_CONTAINER_MAX = 65535;

function buildSingleBandUint16Raster(values: ReadonlyArray<number>): RasterImage {
  return {
    bandPixels: [new Uint16Array(values)],
    width: values.length,
    height: 1,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 1,
  };
}

function buildMultiBandUint16Raster(bands: ReadonlyArray<ReadonlyArray<number>>): RasterImage {
  return {
    bandPixels: bands.map((band) => new Uint16Array(band)),
    width: bands[0]?.length ?? 0,
    height: 1,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: bands.length,
  };
}

function rasterSource(raster: RasterImage): ViewportImageSource {
  return { kind: "raster", raster };
}

function normalizedDisplayRangeWidth(source: ViewportImageSource, bandIndex = 0): number {
  const extents = computeImageRgbChannelExtents(source, bandIndex);
  return extents.max[0] - extents.min[0];
}

describe("CT-071: Normalized viewing tracks current post-operation data", () => {
  it("widens the displayed normalization range after Bit Shift on a near-uniform band", () => {
    const nearUniformDimBand = [2000, 2010, 2020, 2030, 2040, 2050, 2060];
    const raster = buildSingleBandUint16Raster(nearUniformDimBand);
    const before = computeImageRgbChannelExtents(rasterSource(raster));

    const shifted = applyBitShiftToRasterImage(raster, 4);
    const after = computeImageRgbChannelExtents(rasterSource(shifted));

    // The stretch interval must move with the brightened pixels: max climbs from
    // ~0.031 (raw container fraction) to ~0.503 after a x16 shift.
    expect(after.max[0]).toBeGreaterThan(before.max[0]);
    expect(after.min[0]).toBeGreaterThan(before.min[0]);
    // And the displayed range the stretch spans is ~16x wider, so the contrast the
    // user sees when toggling Normalized viewing genuinely changes after Bit Shift.
    expect(normalizedDisplayRangeWidth(rasterSource(shifted))).toBeGreaterThan(
      normalizedDisplayRangeWidth(rasterSource(raster)) * 8,
    );
  });

  it("does not mutate the original raster, so freshly opened content normalizes unchanged", () => {
    const raster = buildSingleBandUint16Raster([1000, 2000, 3000, 4000]);
    const beforeFirst = computeImageRgbChannelExtents(rasterSource(raster));

    applyBitShiftToRasterImage(raster, 4);
    const beforeSecond = computeImageRgbChannelExtents(rasterSource(raster));

    expect(beforeSecond).toEqual(beforeFirst);
    expect(beforeFirst.max[0]).toBeCloseTo(4000 / UINT16_CONTAINER_MAX, 6);
  });

  it("normalizes from the kept band's pixels after Keep Bands remaps band indices", () => {
    const dimBand = [100, 110, 120, 130];
    const brightBand = [40000, 50000, 60000, 64000];
    const raster = buildMultiBandUint16Raster([dimBand, brightBand]);

    // Keep only the originally-bright band; it becomes band 0 of the new raster.
    const keptBrightOnly = applyBandKeepToRasterImage(raster, [1]);
    const keptExtents = computeImageRgbChannelExtents(rasterSource(keptBrightOnly), 0);

    expect(keptExtents.max[0]).toBeCloseTo(64000 / UINT16_CONTAINER_MAX, 6);
    expect(keptExtents.min[0]).toBeCloseTo(40000 / UINT16_CONTAINER_MAX, 6);
  });
});
