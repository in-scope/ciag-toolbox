// CT-230: a miniature capture written through the SAME writer code paths as the
// scale10 fixture generator must load via the app's real ENVI reader and real
// TIFF loader, with every pixel matching the oracle formula
// value(band, x, y) = (band + 1) * 600 + (x % 100) + (y % 100).

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { loadTiffAsRaster } from "@/lib/image/load-tiff";
import { parseEnviHeaderText } from "@/lib/image/parse-envi-header";
import type { RasterTypedArray } from "@/lib/image/raster-image";
import { readEnviBinaryAsBandPixels } from "@/lib/image/read-envi-binary";

import {
  buildEnviBsqUint16HeaderText,
  computeOracleBandMean,
  computeOraclePixelValue,
  describeCaptureForManifest,
  emitEnviBsqUint16BinaryBytes,
  emitMultiPageUint16TiffBytes,
  type EmitFixtureBytes,
  type ScaleFixtureCaptureSpec,
} from "../../../../../scripts/scale-fixture-writers.mjs";
import { streamRgbaPngUsingRowProvider } from "../../../../../scripts/png-utils.mjs";

const MINIATURE_SPEC: ScaleFixtureCaptureSpec = {
  width: 300,
  height: 200,
  bandCount: 5,
  bandBase: (bandIndex) => (bandIndex + 1) * 600,
};

function collectEmittedBytes(emitAll: (emitBytes: EmitFixtureBytes) => void): Uint8Array {
  const parts: Uint8Array[] = [];
  emitAll((bytes) => parts.push(bytes));
  return concatByteParts(parts);
}

function concatByteParts(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  return joined;
}

function findFirstOracleMismatch(
  bandPixels: ReadonlyArray<RasterTypedArray>,
  spec: ScaleFixtureCaptureSpec,
): string | null {
  for (let bandIndex = 0; bandIndex < spec.bandCount; bandIndex++) {
    const mismatch = findFirstOracleMismatchInBand(bandPixels[bandIndex]!, spec, bandIndex);
    if (mismatch) return mismatch;
  }
  return null;
}

function findFirstOracleMismatchInBand(
  band: RasterTypedArray,
  spec: ScaleFixtureCaptureSpec,
  bandIndex: number,
): string | null {
  for (let y = 0; y < spec.height; y++) {
    for (let x = 0; x < spec.width; x++) {
      const expected = computeOraclePixelValue(spec, bandIndex, x, y);
      const actual = band[y * spec.width + x];
      if (actual !== expected) return `band ${bandIndex} (${x},${y}): got ${actual}, want ${expected}`;
    }
  }
  return null;
}

describe("scale10 fixture writers round-trip through the real readers", () => {
  it("loads the miniature ENVI BSQ capture via the real ENVI reader with every pixel on the oracle", () => {
    const header = parseEnviHeaderText(buildEnviBsqUint16HeaderText(MINIATURE_SPEC));
    expect(header).toMatchObject({
      samples: 300,
      lines: 200,
      bands: 5,
      dataType: 12,
      byteOrder: 0,
      interleave: "bsq",
      headerOffset: 0,
    });
    const binary = collectEmittedBytes((emit) => emitEnviBsqUint16BinaryBytes(MINIATURE_SPEC, emit));
    expect(binary.byteLength).toBe(300 * 200 * 5 * 2);
    const bandPixels = readEnviBinaryAsBandPixels(header, binary);
    expect(findFirstOracleMismatch(bandPixels, MINIATURE_SPEC)).toBeNull();
  });

  it("loads the miniature multi-page TIFF via the real TIFF loader with every pixel on the oracle", async () => {
    const bytes = collectEmittedBytes((emit) => emitMultiPageUint16TiffBytes(MINIATURE_SPEC, emit));
    const raster = await loadTiffAsRaster(bytes);
    expect(raster.width).toBe(300);
    expect(raster.height).toBe(200);
    expect(raster.bandCount).toBe(5);
    expect(raster.bitsPerSample).toBe(16);
    expect(raster.sampleFormat).toBe("uint");
    expect(findFirstOracleMismatch(raster.bandPixels, MINIATURE_SPEC)).toBeNull();
  });

  it("loads a miniature single-band TIFF (the per-band fixture shape) via the real TIFF loader", async () => {
    const lastBandIndex = MINIATURE_SPEC.bandCount - 1;
    const singleBandSpec: ScaleFixtureCaptureSpec = {
      width: MINIATURE_SPEC.width,
      height: MINIATURE_SPEC.height,
      bandCount: 1,
      bandBase: () => MINIATURE_SPEC.bandBase(lastBandIndex),
    };
    const bytes = collectEmittedBytes((emit) => emitMultiPageUint16TiffBytes(singleBandSpec, emit));
    const raster = await loadTiffAsRaster(bytes);
    expect(raster.bandCount).toBe(1);
    expect(findFirstOracleMismatch(raster.bandPixels, singleBandSpec)).toBeNull();
  });

  it("describes a capture for the manifest with exact band bases, means, and sample pixels", () => {
    const description = describeCaptureForManifest(MINIATURE_SPEC);
    expect(description.bandBases).toEqual([600, 1200, 1800, 2400, 3000]);
    expect(description.bandMeans).toEqual([699, 1299, 1899, 2499, 3099]);
    expect(description.samplePixels.map((pixel) => ({ x: pixel.x, y: pixel.y }))).toEqual([
      { x: 0, y: 0 },
      { x: 299, y: 199 },
      { x: 150, y: 250 },
    ]);
    expect(description.samplePixels[0]!.valuesPerBand).toEqual([600, 1200, 1800, 2400, 3000]);
    expect(computeOracleBandMean(MINIATURE_SPEC, 0)).toBe(699);
  });
});

describe("streamed RGBA PNG (the big-photo writer path)", () => {
  const PHOTO_WIDTH = 300;
  const PHOTO_HEIGHT = 200;

  function buildMiniaturePhotoRgbaRow(y: number): Uint8Array {
    const row = new Uint8Array(PHOTO_WIDTH * 4);
    for (let x = 0; x < PHOTO_WIDTH; x++) {
      const offset = x * 4;
      row[offset] = 100 + (x % 100);
      row[offset + 1] = 100 + (y % 100);
      row[offset + 2] = 50;
      row[offset + 3] = 255;
    }
    return row;
  }

  async function streamMiniaturePhotoPngBytes(): Promise<Uint8Array> {
    const parts: Uint8Array[] = [];
    await streamRgbaPngUsingRowProvider(PHOTO_WIDTH, PHOTO_HEIGHT, buildMiniaturePhotoRgbaRow, (bytes) => {
      parts.push(bytes);
    });
    return concatByteParts(parts);
  }

  function findFirstChannelFormulaMismatch(rgba: Uint8Array): string | null {
    for (let y = 0; y < PHOTO_HEIGHT; y++) {
      for (let x = 0; x < PHOTO_WIDTH; x++) {
        const offset = (y * PHOTO_WIDTH + x) * 4;
        const [r, g, b] = [rgba[offset], rgba[offset + 1], rgba[offset + 2]];
        if (r !== 100 + (x % 100) || g !== 100 + (y % 100) || b !== 50) {
          return `(${x},${y}): got rgb(${r},${g},${b})`;
        }
      }
    }
    return null;
  }

  it("decodes as a PNG whose every pixel matches the big-photo channel formula", async () => {
    const png = await streamMiniaturePhotoPngBytes();
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(PHOTO_WIDTH);
    expect(info.height).toBe(PHOTO_HEIGHT);
    expect(info.channels).toBe(4);
    expect(findFirstChannelFormulaMismatch(new Uint8Array(data))).toBeNull();
  });
});
