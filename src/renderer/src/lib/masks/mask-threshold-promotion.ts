import type { RasterImage, RasterTypedArray } from "@/lib/image/raster-image";
import {
  filterLoadedReferenceCandidatesByDimensions,
  type LoadedReferenceCandidate,
} from "@/lib/image/reference-token";
import { clampSelectedMaskCategoryIndex } from "@/lib/masks/mask-brush";
import type { MaskLayer } from "@/lib/masks/mask-layer";

// CT-305: promoting a Threshold result into a mask category. A qualifying
// source is a plain 2-level 8-bit unsigned raster (the CT-200 binary-stack
// shape every Threshold apply produces) whose every band holds only 0 and
// 255 - the same dimension-restricted picker shape CT-300 introduced, plus
// this value check.

const THRESHOLD_RESULT_BITS_PER_SAMPLE = 8;
export const THRESHOLD_RESULT_BLACK_VALUE = 0;
export const THRESHOLD_RESULT_WHITE_VALUE = 255;

export function isTwoLevelUint8ThresholdResultRaster(raster: RasterImage): boolean {
  if (raster.sampleFormat !== "uint" || raster.bitsPerSample !== THRESHOLD_RESULT_BITS_PER_SAMPLE) {
    return false;
  }
  return raster.bandPixels.every(doesBandHoldOnlyBlackAndWhiteValues);
}

function doesBandHoldOnlyBlackAndWhiteValues(band: RasterTypedArray): boolean {
  for (const value of band) {
    if (value !== THRESHOLD_RESULT_BLACK_VALUE && value !== THRESHOLD_RESULT_WHITE_VALUE) return false;
  }
  return true;
}

export function filterLoadedReferenceCandidatesQualifyingForMaskPromotion(
  candidates: ReadonlyArray<LoadedReferenceCandidate>,
  width: number,
  height: number,
  excludeToken?: string,
): LoadedReferenceCandidate[] {
  return filterLoadedReferenceCandidatesByDimensions(candidates, width, height, excludeToken).filter(
    (candidate) => isTwoLevelUint8ThresholdResultRaster(candidate.raster),
  );
}

// White pixels of the source band take the currently selected category;
// black pixels leave whatever the layer already held at that pixel.
export function promoteThresholdBandToMaskCategory(
  layer: MaskLayer,
  bandPixels: RasterTypedArray,
  selectedCategoryIndex: number,
): MaskLayer {
  const categoryValue = clampSelectedMaskCategoryIndex(selectedCategoryIndex, layer.categories.length);
  const values = new Uint8Array(layer.values);
  for (let index = 0; index < values.length; index += 1) {
    if (bandPixels[index] === THRESHOLD_RESULT_WHITE_VALUE) values[index] = categoryValue;
  }
  return { ...layer, values };
}
