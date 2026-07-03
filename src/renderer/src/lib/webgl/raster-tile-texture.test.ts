import { describe, expect, it } from "vitest";

import type { RasterImage } from "@/lib/image/raster-image";
import {
  createRgbCompositeTextureForRasterTileTriple,
  createSingleBandTextureForRasterTile,
} from "./raster-tile-texture";
import type { RasterTile } from "./raster-tile-splitter";

// Float rasters (PCA/MNF components, band math) carry raw values far beyond
// half-float's ~65504 max finite value; storing their tiles in R16F overflowed
// on upload and binarized the display (the venere PCA field regression). Float
// tiles must reserve lossless float32 storage and upload the exact raw values,
// while integer tiles stay on the pre-scaled-[0,1] half-float path.

const GL = {
  TEXTURE_2D: 0x0de1,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_MAG_FILTER: 0x2800,
  TEXTURE_WRAP_S: 0x2802,
  TEXTURE_WRAP_T: 0x2803,
  LINEAR: 0x2601,
  NEAREST: 0x2600,
  CLAMP_TO_EDGE: 0x812f,
  R16F: 0x822d,
  R32F: 0x822e,
  RGBA16F: 0x881a,
  RGBA32F: 0x8814,
  RED: 0x1903,
  RGBA: 0x1908,
  FLOAT: 0x1406,
} as const;

const FLOAT_LINEAR_EXTENSION = "OES_texture_float_linear";
const VALUES_BEYOND_HALF_FLOAT = [-194672.5, 447022.75, 65504, -65504];

interface RecordedTextureCalls {
  reservedInternalFormats: number[];
  uploadedPixelArrays: Float32Array[];
  parameterValuesByName: Map<number, number>;
}

interface MockWebGl2 {
  readonly gl: WebGL2RenderingContext;
  readonly calls: RecordedTextureCalls;
}

function makeMockWebGl2(options: { floatLinearSupported: boolean }): MockWebGl2 {
  const calls: RecordedTextureCalls = {
    reservedInternalFormats: [],
    uploadedPixelArrays: [],
    parameterValuesByName: new Map(),
  };
  const gl = {
    ...GL,
    createTexture: () => ({}) as WebGLTexture,
    bindTexture: () => undefined,
    getExtension: (name: string) =>
      name === FLOAT_LINEAR_EXTENSION && options.floatLinearSupported ? {} : null,
    texParameteri: (_target: number, name: number, value: number) => {
      calls.parameterValuesByName.set(name, value);
    },
    texStorage2D: (_target: number, _levels: number, internalFormat: number) => {
      calls.reservedInternalFormats.push(internalFormat);
    },
    texSubImage2D: (...args: unknown[]) => {
      calls.uploadedPixelArrays.push(args[args.length - 1] as Float32Array);
    },
  };
  return { gl: gl as unknown as WebGL2RenderingContext, calls };
}

function makeTile(pixels: RasterTile["pixels"]): RasterTile {
  return { x: 0, y: 0, width: 2, height: 2, pixels };
}

function makeFloatRaster(pixels: Float32Array): RasterImage {
  return {
    bandPixels: [pixels],
    width: 2,
    height: 2,
    bitsPerSample: 32,
    sampleFormat: "float",
    bandCount: 1,
  };
}

function makeUint16Raster(pixels: Uint16Array): RasterImage {
  return {
    bandPixels: [pixels],
    width: 2,
    height: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 1,
  };
}

describe("createSingleBandTextureForRasterTile", () => {
  it("reserves lossless float32 storage for a float raster tile", () => {
    const { gl, calls } = makeMockWebGl2({ floatLinearSupported: true });
    const pixels = new Float32Array(VALUES_BEYOND_HALF_FLOAT);

    createSingleBandTextureForRasterTile(gl, makeTile(pixels), makeFloatRaster(pixels));

    expect(calls.reservedInternalFormats).toEqual([GL.R32F]);
  });

  it("uploads a float tile's raw values bit-exactly, including beyond half-float range", () => {
    const { gl, calls } = makeMockWebGl2({ floatLinearSupported: true });
    const pixels = new Float32Array(VALUES_BEYOND_HALF_FLOAT);

    createSingleBandTextureForRasterTile(gl, makeTile(pixels), makeFloatRaster(pixels));

    expect(Array.from(calls.uploadedPixelArrays[0]!)).toEqual(VALUES_BEYOND_HALF_FLOAT);
  });

  it("keeps half-float storage for an integer raster tile, pre-scaled into [0, 1]", () => {
    const { gl, calls } = makeMockWebGl2({ floatLinearSupported: true });
    const pixels = new Uint16Array([0, 32768, 65535, 100]);

    createSingleBandTextureForRasterTile(gl, makeTile(pixels), makeUint16Raster(pixels));

    expect(calls.reservedInternalFormats).toEqual([GL.R16F]);
    const uploaded = Array.from(calls.uploadedPixelArrays[0]!);
    expect(Math.min(...uploaded)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...uploaded)).toBeLessThanOrEqual(1);
  });

  it("uses LINEAR minification for float tiles when float-linear filtering is available", () => {
    const { gl, calls } = makeMockWebGl2({ floatLinearSupported: true });
    const pixels = new Float32Array(VALUES_BEYOND_HALF_FLOAT);

    createSingleBandTextureForRasterTile(gl, makeTile(pixels), makeFloatRaster(pixels));

    expect(calls.parameterValuesByName.get(GL.TEXTURE_MIN_FILTER)).toBe(GL.LINEAR);
  });

  it("falls back to NEAREST minification for float tiles when float-linear filtering is missing", () => {
    const { gl, calls } = makeMockWebGl2({ floatLinearSupported: false });
    const pixels = new Float32Array(VALUES_BEYOND_HALF_FLOAT);

    createSingleBandTextureForRasterTile(gl, makeTile(pixels), makeFloatRaster(pixels));

    expect(calls.parameterValuesByName.get(GL.TEXTURE_MIN_FILTER)).toBe(GL.NEAREST);
  });
});

describe("createRgbCompositeTextureForRasterTileTriple", () => {
  it("reserves lossless float32 storage for a float composite", () => {
    const { gl, calls } = makeMockWebGl2({ floatLinearSupported: true });
    const pixels = new Float32Array(VALUES_BEYOND_HALF_FLOAT);
    const raster = { ...makeFloatRaster(pixels), bandCount: 3, colorInterpretation: "rgb" as const };

    createRgbCompositeTextureForRasterTileTriple(
      gl,
      [makeTile(pixels), makeTile(pixels), makeTile(pixels)],
      raster,
    );

    expect(calls.reservedInternalFormats).toEqual([GL.RGBA32F]);
  });

  it("keeps half-float storage for an integer composite", () => {
    const { gl, calls } = makeMockWebGl2({ floatLinearSupported: true });
    const pixels = new Uint16Array([0, 32768, 65535, 100]);
    const raster = { ...makeUint16Raster(pixels), bandCount: 3, colorInterpretation: "rgb" as const };

    createRgbCompositeTextureForRasterTileTriple(
      gl,
      [makeTile(pixels), makeTile(pixels), makeTile(pixels)],
      raster,
    );

    expect(calls.reservedInternalFormats).toEqual([GL.RGBA16F]);
  });
});
