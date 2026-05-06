import { describe, expect, it } from "vitest";

import { loadEnviAsRaster } from "@/lib/image/load-envi";
import type { EnviInterleave } from "@/lib/image/parse-envi-header";

const ENVI_DATA_TYPE_UINT16 = 12;
const ENVI_DATA_TYPE_FLOAT32 = 4;
const ENVI_DATA_TYPE_FLOAT64 = 5;
const ENVI_DATA_TYPE_COMPLEX_FLOAT32 = 6;

interface EnviCubeFixtureSpec {
  readonly samples: number;
  readonly lines: number;
  readonly bands: number;
  readonly dataType: number;
  readonly byteOrder: 0 | 1;
  readonly interleave: EnviInterleave;
  readonly bandPixels: ReadonlyArray<ReadonlyArray<number>>;
  readonly wavelengthLine?: string;
  readonly bandNamesLine?: string;
}

describe("loadEnviAsRaster", () => {
  it("decodes a small uint16 BIP cube into per-band pixels at samples x lines", () => {
    const fixture = buildSyntheticEnviCubeFixture({
      samples: 2,
      lines: 3,
      bands: 2,
      dataType: ENVI_DATA_TYPE_UINT16,
      byteOrder: 0,
      interleave: "bip",
      bandPixels: [
        [10, 20, 30, 40, 50, 60],
        [110, 120, 130, 140, 150, 160],
      ],
      wavelengthLine: "wavelength = { 450, 550 }",
    });
    const raster = loadEnviAsRaster(fixture.headerBytes, fixture.binaryBytes);
    expect(raster.width).toBe(2);
    expect(raster.height).toBe(3);
    expect(raster.bandCount).toBe(2);
    expect(raster.bitsPerSample).toBe(16);
    expect(raster.sampleFormat).toBe("uint");
    expect(raster.bandWavelengths).toEqual([450, 550]);
    expect(Array.from(raster.bandPixels[0]!)).toEqual([10, 20, 30, 40, 50, 60]);
    expect(Array.from(raster.bandPixels[1]!)).toEqual([110, 120, 130, 140, 150, 160]);
  });

  it("decodes a uint16 BSQ cube into the same per-band layout as BIP", () => {
    const fixture = buildSyntheticEnviCubeFixture({
      samples: 2,
      lines: 2,
      bands: 2,
      dataType: ENVI_DATA_TYPE_UINT16,
      byteOrder: 0,
      interleave: "bsq",
      bandPixels: [
        [1, 2, 3, 4],
        [5, 6, 7, 8],
      ],
    });
    const raster = loadEnviAsRaster(fixture.headerBytes, fixture.binaryBytes);
    expect(Array.from(raster.bandPixels[0]!)).toEqual([1, 2, 3, 4]);
    expect(Array.from(raster.bandPixels[1]!)).toEqual([5, 6, 7, 8]);
  });

  it("decodes a uint16 BIL cube identically regardless of disk interleave", () => {
    const fixture = buildSyntheticEnviCubeFixture({
      samples: 2,
      lines: 2,
      bands: 2,
      dataType: ENVI_DATA_TYPE_UINT16,
      byteOrder: 0,
      interleave: "bil",
      bandPixels: [
        [1, 2, 3, 4],
        [5, 6, 7, 8],
      ],
    });
    const raster = loadEnviAsRaster(fixture.headerBytes, fixture.binaryBytes);
    expect(Array.from(raster.bandPixels[0]!)).toEqual([1, 2, 3, 4]);
    expect(Array.from(raster.bandPixels[1]!)).toEqual([5, 6, 7, 8]);
  });

  it("decodes a big-endian uint16 cube using the byte-order field", () => {
    const fixture = buildSyntheticEnviCubeFixture({
      samples: 2,
      lines: 1,
      bands: 1,
      dataType: ENVI_DATA_TYPE_UINT16,
      byteOrder: 1,
      interleave: "bsq",
      bandPixels: [[0x0102, 0x0304]],
    });
    const raster = loadEnviAsRaster(fixture.headerBytes, fixture.binaryBytes);
    expect(Array.from(raster.bandPixels[0]!)).toEqual([0x0102, 0x0304]);
  });

  it("decodes a float32 cube into Float32Array bands", () => {
    const fixture = buildSyntheticEnviCubeFixture({
      samples: 2,
      lines: 1,
      bands: 1,
      dataType: ENVI_DATA_TYPE_FLOAT32,
      byteOrder: 0,
      interleave: "bsq",
      bandPixels: [[1.5, 2.25]],
    });
    const raster = loadEnviAsRaster(fixture.headerBytes, fixture.binaryBytes);
    expect(raster.sampleFormat).toBe("float");
    expect(raster.bitsPerSample).toBe(32);
    expect(raster.bandPixels[0]).toBeInstanceOf(Float32Array);
    expect(Array.from(raster.bandPixels[0]!)).toEqual([1.5, 2.25]);
  });

  it("captures band names from the header when present and length matches band count", () => {
    const fixture = buildSyntheticEnviCubeFixture({
      samples: 1,
      lines: 1,
      bands: 2,
      dataType: ENVI_DATA_TYPE_UINT16,
      byteOrder: 0,
      interleave: "bsq",
      bandPixels: [[1], [2]],
      bandNamesLine: "band names = { Red, Green }",
    });
    const raster = loadEnviAsRaster(fixture.headerBytes, fixture.binaryBytes);
    expect(raster.bandLabels).toEqual(["Red", "Green"]);
  });

  it("rejects a header that does not start with the ENVI magic line", () => {
    const headerBytes = new TextEncoder().encode("NOTENVI\nsamples = 1\n");
    expect(() => loadEnviAsRaster(headerBytes, new Uint8Array(2))).toThrow(/ENVI magic line/);
  });

  it("rejects double-precision float ENVI cubes", () => {
    const headerText = buildEnviHeaderText({
      samples: 1,
      lines: 1,
      bands: 1,
      dataType: ENVI_DATA_TYPE_FLOAT64,
      byteOrder: 0,
      interleave: "bsq",
    });
    expect(() =>
      loadEnviAsRaster(new TextEncoder().encode(headerText), new Uint8Array(8)),
    ).toThrow(/Double-precision float/);
  });

  it("rejects complex float ENVI cubes", () => {
    const headerText = buildEnviHeaderText({
      samples: 1,
      lines: 1,
      bands: 1,
      dataType: ENVI_DATA_TYPE_COMPLEX_FLOAT32,
      byteOrder: 0,
      interleave: "bsq",
    });
    expect(() =>
      loadEnviAsRaster(new TextEncoder().encode(headerText), new Uint8Array(8)),
    ).toThrow(/Complex/);
  });

  it("rejects a binary file that is shorter than the header advertises", () => {
    const fixture = buildSyntheticEnviCubeFixture({
      samples: 4,
      lines: 4,
      bands: 1,
      dataType: ENVI_DATA_TYPE_UINT16,
      byteOrder: 0,
      interleave: "bsq",
      bandPixels: [[1, 2, 3, 4]],
    });
    const truncated = fixture.binaryBytes.slice(0, 4);
    expect(() => loadEnviAsRaster(fixture.headerBytes, truncated)).toThrow(/smaller than expected/);
  });
});

interface EnviCubeFixture {
  readonly headerBytes: Uint8Array;
  readonly binaryBytes: Uint8Array;
}

function buildSyntheticEnviCubeFixture(spec: EnviCubeFixtureSpec): EnviCubeFixture {
  const headerText = buildEnviHeaderText(spec);
  const binaryBytes = encodeBandPixelsForInterleave(spec);
  return {
    headerBytes: new TextEncoder().encode(headerText),
    binaryBytes,
  };
}

interface EnviHeaderSpec {
  readonly samples: number;
  readonly lines: number;
  readonly bands: number;
  readonly dataType: number;
  readonly byteOrder: 0 | 1;
  readonly interleave: EnviInterleave;
  readonly wavelengthLine?: string;
  readonly bandNamesLine?: string;
}

function buildEnviHeaderText(spec: EnviHeaderSpec): string {
  const lines = [
    "ENVI",
    `samples = ${spec.samples}`,
    `lines = ${spec.lines}`,
    `bands = ${spec.bands}`,
    "header offset = 0",
    "file type = ENVI Standard",
    `data type = ${spec.dataType}`,
    `interleave = ${spec.interleave}`,
    `byte order = ${spec.byteOrder}`,
  ];
  if (spec.wavelengthLine) lines.push(spec.wavelengthLine);
  if (spec.bandNamesLine) lines.push(spec.bandNamesLine);
  return lines.join("\n") + "\n";
}

function encodeBandPixelsForInterleave(spec: EnviCubeFixtureSpec): Uint8Array {
  const bytesPerSample = pickBytesPerSampleForDataType(spec.dataType);
  const totalSamples = spec.samples * spec.lines * spec.bands;
  const buffer = new ArrayBuffer(totalSamples * bytesPerSample);
  const view = new DataView(buffer);
  const writeSample = pickSampleWriterForDataType(spec.dataType);
  for (let pixelIndex = 0; pixelIndex < spec.samples * spec.lines; pixelIndex++) {
    writePixelAcrossBands(view, spec, pixelIndex, writeSample, bytesPerSample);
  }
  return new Uint8Array(buffer);
}

type WriteSampleFunction = (
  view: DataView,
  byteOffset: number,
  value: number,
  isLittleEndian: boolean,
) => void;

function pickBytesPerSampleForDataType(dataType: number): number {
  if (dataType === ENVI_DATA_TYPE_UINT16) return 2;
  if (dataType === ENVI_DATA_TYPE_FLOAT32) return 4;
  throw new Error(`Test fixture does not support data type ${dataType}`);
}

function pickSampleWriterForDataType(dataType: number): WriteSampleFunction {
  if (dataType === ENVI_DATA_TYPE_UINT16) {
    return (view, offset, value, le) => view.setUint16(offset, value, le);
  }
  if (dataType === ENVI_DATA_TYPE_FLOAT32) {
    return (view, offset, value, le) => view.setFloat32(offset, value, le);
  }
  throw new Error(`Test fixture does not support data type ${dataType}`);
}

function writePixelAcrossBands(
  view: DataView,
  spec: EnviCubeFixtureSpec,
  pixelIndex: number,
  writeSample: WriteSampleFunction,
  bytesPerSample: number,
): void {
  for (let bandIndex = 0; bandIndex < spec.bands; bandIndex++) {
    const value = spec.bandPixels[bandIndex]![pixelIndex]!;
    const byteOffset = computeDiskByteOffset(spec, pixelIndex, bandIndex, bytesPerSample);
    writeSample(view, byteOffset, value, spec.byteOrder === 0);
  }
}

function computeDiskByteOffset(
  spec: EnviCubeFixtureSpec,
  pixelIndex: number,
  bandIndex: number,
  bytesPerSample: number,
): number {
  const sampleX = pixelIndex % spec.samples;
  const sampleY = Math.floor(pixelIndex / spec.samples);
  if (spec.interleave === "bsq") {
    return (bandIndex * spec.lines * spec.samples + pixelIndex) * bytesPerSample;
  }
  if (spec.interleave === "bil") {
    return (
      (sampleY * spec.bands * spec.samples + bandIndex * spec.samples + sampleX) *
      bytesPerSample
    );
  }
  return (pixelIndex * spec.bands + bandIndex) * bytesPerSample;
}
