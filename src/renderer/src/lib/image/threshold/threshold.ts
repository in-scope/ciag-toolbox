import { allocateUint8ArrayOrThrow } from "@/lib/image/raster-allocation";
import type { RasterTypedArray } from "@/lib/image/raster-image";

// CT-200: manual threshold. A pixel whose value falls inside the inclusive
// [lower, upper] bounds becomes white; everything else becomes black. The
// output is always an 8-bit binary band holding exactly these two levels.

export const THRESHOLD_WHITE_LEVEL = 255;
export const THRESHOLD_BLACK_LEVEL = 0;

export interface ThresholdBounds {
  readonly lower: number;
  readonly upper: number;
}

export function isValueWithinThresholdBounds(value: number, bounds: ThresholdBounds): boolean {
  return value >= bounds.lower && value <= bounds.upper;
}

export function applyManualThreshold(
  band: RasterTypedArray,
  bounds: ThresholdBounds,
): Uint8Array {
  const out = allocateUint8ArrayOrThrow(band.length);
  for (let i = 0; i < band.length; i += 1) {
    out[i] = isValueWithinThresholdBounds(band[i] ?? 0, bounds)
      ? THRESHOLD_WHITE_LEVEL
      : THRESHOLD_BLACK_LEVEL;
  }
  return out;
}

// The combine-all scope reduces the whole stack to ONE binary band: a pixel is
// white only when its value in EVERY band falls inside the bounds (the
// intersection of the per-band masks).
export function applyManualThresholdAcrossBands(
  bands: ReadonlyArray<RasterTypedArray>,
  bounds: ThresholdBounds,
): Uint8Array {
  const firstBand = bands[0];
  if (!firstBand) throw new Error("Threshold needs at least one band.");
  const out = allocateUint8ArrayOrThrow(firstBand.length);
  for (let i = 0; i < firstBand.length; i += 1) {
    out[i] = pixelIsWithinBoundsInEveryBand(bands, i, bounds)
      ? THRESHOLD_WHITE_LEVEL
      : THRESHOLD_BLACK_LEVEL;
  }
  return out;
}

function pixelIsWithinBoundsInEveryBand(
  bands: ReadonlyArray<RasterTypedArray>,
  pixelIndex: number,
  bounds: ThresholdBounds,
): boolean {
  for (const band of bands) {
    if (!isValueWithinThresholdBounds(band[pixelIndex] ?? 0, bounds)) return false;
  }
  return true;
}
