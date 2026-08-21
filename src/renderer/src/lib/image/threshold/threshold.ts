import { allocateUint8ArrayOrThrow } from "@/lib/image/raster-allocation";
import type { RasterTypedArray } from "@/lib/image/raster-image";

// CT-200: manual threshold. A pixel whose value falls inside the inclusive
// [lower, upper] bounds becomes white; everything else becomes black. The
// output is always an 8-bit binary band holding exactly these two levels.
// CT-282: thresholding never combines bands - the full-stack scope applies
// one set of bounds to EVERY band, producing one binary band per source band.

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
