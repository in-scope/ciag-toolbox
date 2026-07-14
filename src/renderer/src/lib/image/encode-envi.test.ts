import { describe, expect, it } from "vitest";

import {
  encodeRasterImageAsEnviFiles,
  encodeRasterImageAsEnviFilesReportingProgress,
  encodeRasterImageAsFloat32EnviFiles,
  encodeRasterImageAsFloat32EnviFilesReportingProgress,
  planFloat32EnviFilesChunkedEncoding,
} from "@/lib/image/encode-envi";
import { loadEnviAsRaster } from "@/lib/image/load-envi";
import { parseEnviHeaderText } from "@/lib/image/parse-envi-header";
import type { RasterImage, RasterSourceInterleave } from "@/lib/image/raster-image";

describe("encodeRasterImageAsEnviFiles", () => {
  it("preserves the source interleave when the raster came from ENVI", () => {
    const raster = buildRasterFixture({ sourceInterleave: "bsq" });
    const encoded = encodeRasterImageAsEnviFiles(raster);
    expect(encoded.interleave).toBe("bsq");
    expect(parseEnviHeaderText(decodeBytes(encoded.headerBytes)).interleave).toBe("bsq");
  });

  it("defaults to BIL interleave for sources without source interleave metadata", () => {
    const raster = buildRasterFixture({ sourceInterleave: undefined });
    const encoded = encodeRasterImageAsEnviFiles(raster);
    expect(encoded.interleave).toBe("bil");
  });

  it("writes core dimensions and data type into the header", () => {
    const raster = buildRasterFixture({ sourceInterleave: "bil" });
    const encoded = encodeRasterImageAsEnviFiles(raster);
    const header = parseEnviHeaderText(decodeBytes(encoded.headerBytes));
    expect(header.samples).toBe(raster.width);
    expect(header.lines).toBe(raster.height);
    expect(header.bands).toBe(raster.bandCount);
    expect(header.dataType).toBe(12);
    expect(header.byteOrder).toBe(0);
  });

  it("writes wavelength metadata when the source raster has it", () => {
    const raster = buildRasterFixture({
      sourceInterleave: "bsq",
      bandWavelengths: [450, 550],
    });
    const encoded = encodeRasterImageAsEnviFiles(raster);
    const header = parseEnviHeaderText(decodeBytes(encoded.headerBytes));
    expect(header.wavelengths).toEqual([450, 550]);
  });

  it("writes band names when the labels match the band count", () => {
    const raster = buildRasterFixture({
      sourceInterleave: "bsq",
      bandLabels: ["Red", "Green"],
    });
    const encoded = encodeRasterImageAsEnviFiles(raster);
    const header = parseEnviHeaderText(decodeBytes(encoded.headerBytes));
    expect(header.bandNames).toEqual(["Red", "Green"]);
  });

  it("rejects non-raster typed-array formats with a clear error", () => {
    const raster: RasterImage = {
      bandPixels: [new Float64Array([1])],
      width: 1,
      height: 1,
      bandCount: 1,
      bitsPerSample: 64,
      sampleFormat: "float",
    };
    expect(() => encodeRasterImageAsEnviFiles(raster)).toThrow(
      /ENVI write does not support raster format/,
    );
  });

  it("round-trips an ENVI BIP raster (read -> write -> read) producing identical pixels", () => {
    const originalRaster = buildRasterFixture({ sourceInterleave: "bip" });
    const encoded = encodeRasterImageAsEnviFiles(originalRaster);
    const reloaded = loadEnviAsRaster(encoded.headerBytes, encoded.binaryBytes);
    assertRastersHaveIdenticalCorePixelData(reloaded, originalRaster);
    expect(reloaded.sourceInterleave).toBe("bip");
  });

  it("round-trips an ENVI BSQ raster (read -> write -> read) producing identical pixels", () => {
    const originalRaster = buildRasterFixture({ sourceInterleave: "bsq" });
    const encoded = encodeRasterImageAsEnviFiles(originalRaster);
    const reloaded = loadEnviAsRaster(encoded.headerBytes, encoded.binaryBytes);
    assertRastersHaveIdenticalCorePixelData(reloaded, originalRaster);
    expect(reloaded.sourceInterleave).toBe("bsq");
  });

  it("round-trips an ENVI BIL raster (read -> write -> read) producing identical pixels", () => {
    const originalRaster = buildRasterFixture({ sourceInterleave: "bil" });
    const encoded = encodeRasterImageAsEnviFiles(originalRaster);
    const reloaded = loadEnviAsRaster(encoded.headerBytes, encoded.binaryBytes);
    assertRastersHaveIdenticalCorePixelData(reloaded, originalRaster);
    expect(reloaded.sourceInterleave).toBe("bil");
  });

  it("round-trips a float32 ENVI cube without precision loss", () => {
    const originalRaster: RasterImage = {
      bandPixels: [new Float32Array([1.5, 2.25, 3.5, 4.0])],
      width: 2,
      height: 2,
      bandCount: 1,
      bitsPerSample: 32,
      sampleFormat: "float",
      sourceInterleave: "bsq",
    };
    const encoded = encodeRasterImageAsEnviFiles(originalRaster);
    const reloaded = loadEnviAsRaster(encoded.headerBytes, encoded.binaryBytes);
    expect(Array.from(reloaded.bandPixels[0]!)).toEqual([1.5, 2.25, 3.5, 4.0]);
  });

  it("encodes a float32 cube including out-of-range values losslessly via the float path", () => {
    const originalRaster: RasterImage = {
      bandPixels: [new Float32Array([-2.5, 0, 0.5, 17.25])],
      width: 2,
      height: 2,
      bandCount: 1,
      bitsPerSample: 32,
      sampleFormat: "float",
      sourceInterleave: "bsq",
    };
    const encoded = encodeRasterImageAsFloat32EnviFiles(originalRaster);
    const reloaded = loadEnviAsRaster(encoded.headerBytes, encoded.binaryBytes);
    expect(reloaded.sampleFormat).toBe("float");
    expect(Array.from(reloaded.bandPixels[0]!)).toEqual([-2.5, 0, 0.5, 17.25]);
  });

  it("coerces a uint16 raster to a float32 ENVI file via the float path", () => {
    const originalRaster = buildRasterFixture({ sourceInterleave: "bsq" });
    const encoded = encodeRasterImageAsFloat32EnviFiles(originalRaster);
    const header = parseEnviHeaderText(decodeBytes(encoded.headerBytes));
    expect(header.dataType).toBe(4);
    const reloaded = loadEnviAsRaster(encoded.headerBytes, encoded.binaryBytes);
    expect(reloaded.sampleFormat).toBe("float");
    expect(reloaded.bitsPerSample).toBe(32);
    expect(Array.from(reloaded.bandPixels[0]!)).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it("round-trips wavelength + band-name metadata across a write/read cycle", () => {
    const originalRaster = buildRasterFixture({
      sourceInterleave: "bsq",
      bandLabels: ["Red", "Green"],
      bandWavelengths: [620, 540],
    });
    const encoded = encodeRasterImageAsEnviFiles(originalRaster);
    const reloaded = loadEnviAsRaster(encoded.headerBytes, encoded.binaryBytes);
    expect(reloaded.bandLabels).toEqual(["Red", "Green"]);
    expect(reloaded.bandWavelengths).toEqual([620, 540]);
  });
});

// CT-219f: the ...ReportingProgress twins must produce identical files to the sync
// encoders while filling the binary in chunks. A tiny samplesPerChunk forces one unit
// (one band-row or one image line) per chunk so the equivalence covers chunk boundaries.
describe("chunked ENVI encoding twins (CT-219f)", () => {
  const FORCED_SAMPLES_PER_CHUNK = 1;

  it.each(["bsq", "bil", "bip"] as const)(
    "%s output is identical to the sync encoder",
    async (interleave) => {
      const raster = buildRasterFixture({ sourceInterleave: interleave });
      const chunked = await encodeRasterImageAsEnviFilesReportingProgress(
        raster,
        undefined,
        FORCED_SAMPLES_PER_CHUNK,
      );
      expect(chunked).toEqual(encodeRasterImageAsEnviFiles(raster));
    },
  );

  it("float32 coercion of a uint16 raster is identical to the sync float encoder", async () => {
    const raster = buildRasterFixture({ sourceInterleave: "bsq" });
    const chunked = await encodeRasterImageAsFloat32EnviFilesReportingProgress(
      raster,
      undefined,
      FORCED_SAMPLES_PER_CHUNK,
    );
    expect(chunked).toEqual(encodeRasterImageAsFloat32EnviFiles(raster));
  });

  it("an already-float32 raster skips the conversion window and matches the sync encoder", async () => {
    const raster: RasterImage = {
      bandPixels: [new Float32Array([1.5, 2.25, 3.5, 4.0])],
      width: 2,
      height: 2,
      bandCount: 1,
      bitsPerSample: 32,
      sampleFormat: "float",
      sourceInterleave: "bsq",
    };
    const fractions: number[] = [];
    const chunked = await encodeRasterImageAsFloat32EnviFilesReportingProgress(
      raster,
      (fraction) => fractions.push(fraction),
      FORCED_SAMPLES_PER_CHUNK,
    );
    expect(chunked).toEqual(encodeRasterImageAsFloat32EnviFiles(raster));
    expect(fractions).toEqual([1 / 2, 1]);
  });

  it("reports one monotonic tick per chunked unit ending at exactly 1", async () => {
    const raster = buildRasterFixture({ sourceInterleave: "bil" });
    const fractions: number[] = [];
    await encodeRasterImageAsEnviFilesReportingProgress(
      raster,
      (fraction) => fractions.push(fraction),
      FORCED_SAMPLES_PER_CHUNK,
    );
    expect(fractions).toEqual([1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1]);
  });

  it("the float coercion path folds conversion ticks into the 0..0.2 window before the fill", async () => {
    const raster = buildRasterFixture({ sourceInterleave: "bsq" });
    const fractions: number[] = [];
    await encodeRasterImageAsFloat32EnviFilesReportingProgress(
      raster,
      (fraction) => fractions.push(fraction),
      FORCED_SAMPLES_PER_CHUNK,
    );
    expect(fractions[0]).toBe(0);
    expect(fractions.at(-1)).toBe(1);
    const sorted = [...fractions].sort((a, b) => a - b);
    expect(fractions).toEqual(sorted);
    expect(fractions.some((fraction) => fraction > 0 && fraction <= 0.2)).toBe(true);
  });
});

// CT-237: the float32 chunked plan backs the ENVI (32-bit float) export. It
// narrows samples as chunks are built instead of converting the cube up front,
// so its concatenated output must be byte-identical to the sync float encoder.
describe("planFloat32EnviFilesChunkedEncoding (CT-237)", () => {
  it.each(["bsq", "bil", "bip"] as const)(
    "%s chunks concatenate byte-identically to the sync float32 encoder",
    async (interleave) => {
      const raster = buildRasterFixture({ sourceInterleave: interleave });
      const sync = encodeRasterImageAsFloat32EnviFiles(raster);
      const plan = planFloat32EnviFilesChunkedEncoding(raster);
      expect(plan.headerBytes).toEqual(sync.headerBytes);
      expect(plan.binaryByteLength).toBe(sync.binaryBytes.byteLength);
      for (const chunkBytes of [1, 3, 7, 1024]) {
        expect(await collectEmittedChunks(plan.emitBinaryChunksInOrder, chunkBytes)).toEqual(
          sync.binaryBytes,
        );
      }
    },
  );

  it("narrows a float64 source exactly like the sync encoder's Float32Array conversion", async () => {
    const raster: RasterImage = {
      bandPixels: [new Float64Array([0.1, 1 / 3, 2.5, -7.75])],
      width: 2,
      height: 2,
      bandCount: 1,
      bitsPerSample: 64,
      sampleFormat: "float",
      sourceInterleave: "bsq",
    };
    const sync = encodeRasterImageAsFloat32EnviFiles(raster);
    const plan = planFloat32EnviFilesChunkedEncoding(raster);
    expect(await collectEmittedChunks(plan.emitBinaryChunksInOrder, 5)).toEqual(sync.binaryBytes);
  });

  it("declares the binary byte length from dimensions alone (4 bytes per sample)", () => {
    const raster = buildRasterFixture({ sourceInterleave: "bil" });
    const plan = planFloat32EnviFilesChunkedEncoding(raster);
    expect(plan.binaryByteLength).toBe(raster.width * raster.height * raster.bandCount * 4);
  });
});

async function collectEmittedChunks(
  emitChunksInOrder: (
    maxChunkBytes: number,
    onChunk: (bytes: Uint8Array) => Promise<void>,
  ) => Promise<void>,
  maxChunkBytes: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  await emitChunksInOrder(maxChunkBytes, async (bytes) => {
    chunks.push(bytes);
  });
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

interface RasterFixtureOverrides {
  readonly sourceInterleave: RasterSourceInterleave | undefined;
  readonly bandLabels?: ReadonlyArray<string>;
  readonly bandWavelengths?: ReadonlyArray<number>;
}

function buildRasterFixture(overrides: RasterFixtureOverrides): RasterImage {
  return {
    bandPixels: [
      new Uint16Array([10, 20, 30, 40, 50, 60]),
      new Uint16Array([110, 120, 130, 140, 150, 160]),
    ],
    width: 2,
    height: 3,
    bandCount: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
    sourceInterleave: overrides.sourceInterleave,
    bandLabels: overrides.bandLabels,
    bandWavelengths: overrides.bandWavelengths,
  };
}

function decodeBytes(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

function assertRastersHaveIdenticalCorePixelData(
  reloaded: RasterImage,
  original: RasterImage,
): void {
  expect(reloaded.width).toBe(original.width);
  expect(reloaded.height).toBe(original.height);
  expect(reloaded.bandCount).toBe(original.bandCount);
  expect(reloaded.bitsPerSample).toBe(original.bitsPerSample);
  expect(reloaded.sampleFormat).toBe(original.sampleFormat);
  for (let bandIndex = 0; bandIndex < original.bandCount; bandIndex++) {
    expect(Array.from(reloaded.bandPixels[bandIndex]!)).toEqual(
      Array.from(original.bandPixels[bandIndex]!),
    );
  }
}
