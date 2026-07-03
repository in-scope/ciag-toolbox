import type { RasterTypedArray } from "@/lib/image/raster-image";

// CT-210: reduce every band of a stack to ONE summary band using a ready-made
// function. "average" is the per-pixel mean across bands; "variance" is the
// per-pixel population variance across bands. Both output float32 and are built
// by the caller through the Stage 3 float path. A custom formula or imported tool
// returns its own H x W band instead (see the return-contract validator and the
// band-selection result store).

export type BandSelectionPreset = "average" | "variance";

// CT-210: the band-selection popup's current choice lives in ViewportRenderingState
// (the editor-owned pattern shared with the band weights). A preset is computed
// synchronously at Apply; a custom formula/tool result is a full band already
// computed by the scripting worker, so it is remembered in the result store under
// a token and the state carries only the token plus a human description.
export type BandSelectionEditingState =
  | { readonly kind: "preset"; readonly preset: BandSelectionPreset }
  | { readonly kind: "custom"; readonly token: string; readonly description: string };

export function reduceCubeToSelectedBand(
  bands: ReadonlyArray<RasterTypedArray>,
  preset: BandSelectionPreset,
): Float32Array {
  return preset === "variance" ? computeVarianceBand(bands) : computeAverageBand(bands);
}

function computeAverageBand(bands: ReadonlyArray<RasterTypedArray>): Float32Array {
  const output = new Float32Array(bands[0]?.length ?? 0);
  for (let pixel = 0; pixel < output.length; pixel += 1) {
    output[pixel] = meanAcrossBandsAtPixel(bands, pixel);
  }
  return output;
}

function computeVarianceBand(bands: ReadonlyArray<RasterTypedArray>): Float32Array {
  const output = new Float32Array(bands[0]?.length ?? 0);
  for (let pixel = 0; pixel < output.length; pixel += 1) {
    output[pixel] = varianceAcrossBandsAtPixel(bands, pixel);
  }
  return output;
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
