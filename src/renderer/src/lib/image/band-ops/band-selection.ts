import { allocateFloat32ArrayOrThrow } from "@/lib/image/raster-allocation";
import type { RasterTypedArray } from "@/lib/image/raster-image";
import { runInChunksReportingProgress, type UnitProgressCallback } from "@/lib/image/unit-progress";

// CT-210: reduce every band of a stack to ONE summary band using a ready-made
// function. "average" is the per-pixel mean across bands; "variance" is the
// per-pixel population variance across bands. Both output float32 and are built
// by the caller through the Stage 3 float path. A custom formula or imported
// tool returns its own H x W band instead (see the return-contract validator),
// flattened here into the same single-band shape.

export type BandSelectionPreset = "average" | "variance";

// CT-293: the "By function" mode's current choice lives in
// ViewportRenderingState (the editor-owned pattern shared with the band
// weights) and CONFIGURES the run instead of executing it: a preset, a formula
// expression, or an imported tool's file path. Everything runs at Apply, so the
// state never carries band data.
export type BandSelectionEditingState =
  | { readonly kind: "preset"; readonly preset: BandSelectionPreset }
  | { readonly kind: "formula"; readonly expression: string }
  | { readonly kind: "tool"; readonly filePath: string; readonly fileName: string };

// CT-293: the reduce is one pass over every pixel of every band, so it runs in
// chunks like the other whole-cube computes - the busy bar stays determinate and
// each chunk boundary is a Stop checkpoint (CT-268).
const PIXELS_PER_REDUCE_CHUNK = 250_000;

type PerPixelBandReducer = (bands: ReadonlyArray<RasterTypedArray>, pixel: number) => number;

export function reduceCubeToSelectedBand(
  bands: ReadonlyArray<RasterTypedArray>,
  preset: BandSelectionPreset,
): Float32Array {
  const output = allocateReducedBand(bands);
  fillReducedBandRange(output, bands, pickPerPixelBandReducer(preset), 0, output.length);
  return output;
}

export async function reduceCubeToSelectedBandInChunks(
  bands: ReadonlyArray<RasterTypedArray>,
  preset: BandSelectionPreset,
  onProgress?: UnitProgressCallback,
  abortSignal?: AbortSignal,
): Promise<Float32Array> {
  const output = allocateReducedBand(bands);
  const reducePixel = pickPerPixelBandReducer(preset);
  await runInChunksReportingProgress(
    output.length,
    PIXELS_PER_REDUCE_CHUNK,
    (start, end) => fillReducedBandRange(output, bands, reducePixel, start, end),
    onProgress,
    abortSignal,
  );
  return output;
}

// A custom formula or tool returns the band as row-major nested arrays
// (validated by the return contract); flattening it to one Float32Array is the
// shape the float raster path expects.
export function flattenBandMatrixToFloat32(
  rows: ReadonlyArray<ReadonlyArray<number>>,
  width: number,
  height: number,
): Float32Array {
  const output = allocateFloat32ArrayOrThrow(width * height);
  for (let row = 0; row < height; row += 1) {
    copyBandRowIntoFloat32(output, rows[row] ?? [], row, width);
  }
  return output;
}

function copyBandRowIntoFloat32(
  output: Float32Array,
  row: ReadonlyArray<number>,
  rowIndex: number,
  width: number,
): void {
  for (let column = 0; column < width; column += 1) {
    output[rowIndex * width + column] = row[column] ?? 0;
  }
}

function allocateReducedBand(bands: ReadonlyArray<RasterTypedArray>): Float32Array {
  return allocateFloat32ArrayOrThrow(bands[0]?.length ?? 0);
}

function pickPerPixelBandReducer(preset: BandSelectionPreset): PerPixelBandReducer {
  return preset === "variance" ? varianceAcrossBandsAtPixel : meanAcrossBandsAtPixel;
}

function fillReducedBandRange(
  output: Float32Array,
  bands: ReadonlyArray<RasterTypedArray>,
  reducePixel: PerPixelBandReducer,
  startPixel: number,
  endPixel: number,
): void {
  for (let pixel = startPixel; pixel < endPixel; pixel += 1) {
    output[pixel] = reducePixel(bands, pixel);
  }
}

function meanAcrossBandsAtPixel(bands: ReadonlyArray<RasterTypedArray>, pixel: number): number {
  if (bands.length === 0) return 0;
  return sumAcrossBandsAtPixel(bands, pixel) / bands.length;
}

function varianceAcrossBandsAtPixel(bands: ReadonlyArray<RasterTypedArray>, pixel: number): number {
  if (bands.length === 0) return 0;
  const mean = meanAcrossBandsAtPixel(bands, pixel);
  return sumOfSquaredDeviationsAtPixel(bands, pixel, mean) / bands.length;
}

function sumAcrossBandsAtPixel(bands: ReadonlyArray<RasterTypedArray>, pixel: number): number {
  let sum = 0;
  for (let band = 0; band < bands.length; band += 1) {
    sum += bands[band]?.[pixel] ?? 0;
  }
  return sum;
}

function sumOfSquaredDeviationsAtPixel(
  bands: ReadonlyArray<RasterTypedArray>,
  pixel: number,
  mean: number,
): number {
  let sum = 0;
  for (let band = 0; band < bands.length; band += 1) {
    const deviation = (bands[band]?.[pixel] ?? 0) - mean;
    sum += deviation * deviation;
  }
  return sum;
}
