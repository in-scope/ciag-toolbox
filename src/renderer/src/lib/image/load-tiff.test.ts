import { writeArrayBuffer } from "geotiff";
import { describe, expect, it } from "vitest";

import { loadTiffAsRaster } from "@/lib/image/load-tiff";

describe("loadTiffAsRaster", () => {
  it("decodes a small single-band uint16 TIFF into a raster image", async () => {
    const bytes = buildSyntheticUint16TiffBytes();
    const raster = await loadTiffAsRaster(bytes);
    expect(raster.width).toBe(SYNTHETIC_TIFF_WIDTH);
    expect(raster.height).toBe(SYNTHETIC_TIFF_HEIGHT);
    expect(raster.bitsPerSample).toBe(16);
    expect(raster.sampleFormat).toBe("uint");
    expect(raster.bandCount).toBe(1);
    expect(raster.pixels).toBeInstanceOf(Uint16Array);
    expect(raster.pixels.length).toBe(SYNTHETIC_TIFF_WIDTH * SYNTHETIC_TIFF_HEIGHT);
  });

  it("rejects bytes that are not a TIFF", async () => {
    const bogus = Uint8Array.of(0, 0, 0, 0);
    await expect(loadTiffAsRaster(bogus)).rejects.toThrow();
  });
});

const SYNTHETIC_TIFF_WIDTH = 8;
const SYNTHETIC_TIFF_HEIGHT = 8;

function buildSyntheticUint16TiffBytes(): Uint8Array {
  const pixels = buildGradientUint16Pixels();
  const buffer = writeArrayBuffer(pixels, buildSyntheticTiffMetadata());
  return new Uint8Array(buffer);
}

function buildGradientUint16Pixels(): Uint16Array {
  const length = SYNTHETIC_TIFF_WIDTH * SYNTHETIC_TIFF_HEIGHT;
  const pixels = new Uint16Array(length);
  for (let i = 0; i < length; i++) {
    pixels[i] = (i * 1024) & 0xffff;
  }
  return pixels;
}

function buildSyntheticTiffMetadata(): Record<string, unknown> {
  return {
    width: SYNTHETIC_TIFF_WIDTH,
    height: SYNTHETIC_TIFF_HEIGHT,
    BitsPerSample: [16],
    SampleFormat: [1],
    SamplesPerPixel: 1,
    PhotometricInterpretation: 1,
    ImageLength: SYNTHETIC_TIFF_HEIGHT,
    ImageWidth: SYNTHETIC_TIFF_WIDTH,
  };
}
