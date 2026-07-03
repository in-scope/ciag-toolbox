import {
  computeBandHistogramFromBandPixels,
  computeBandHistogramFromRaster,
  DEFAULT_BAND_HISTOGRAM_BIN_COUNT,
} from "@/lib/image/compute-band-histogram";
import type { RasterImage, RasterTypedArray } from "@/lib/image/raster-image";

import { computeOtsuBoundsForHistogram } from "./otsu";
import type { ThresholdBounds } from "./threshold";

// CT-201: the Auto button derives an Otsu cutoff for EVERY band up front (plus
// one cutoff over the combined data), because the scope choice is only known
// at Apply time: band-wise thresholds each band with its own cutoff, while the
// combined full-stack scope uses the single cutoff over all bands together.
// The popup keeps showing just the current band's bounds; the full per-band
// list surfaces in the audit trail.

export interface ThresholdOtsuCutoffs {
  readonly perBandBounds: ReadonlyArray<ThresholdBounds>;
  readonly combinedBounds: ThresholdBounds;
}

export function computeOtsuCutoffsForRaster(raster: RasterImage): ThresholdOtsuCutoffs {
  const perBandBounds = raster.bandPixels.map((_pixels, bandIndex) =>
    computeOtsuBoundsForHistogram(computeBandHistogramFromRaster(raster, bandIndex)),
  );
  return { perBandBounds, combinedBounds: computeCombinedOtsuBounds(raster) };
}

function computeCombinedOtsuBounds(raster: RasterImage): ThresholdBounds {
  const histogram = computeBandHistogramFromBandPixels({
    pixels: concatenateAllBandValues(raster.bandPixels),
    sampleFormat: raster.sampleFormat,
    bitsPerSample: raster.bitsPerSample,
    binCount: DEFAULT_BAND_HISTOGRAM_BIN_COUNT,
  });
  return computeOtsuBoundsForHistogram(histogram);
}

// The combined histogram only reads VALUES (an integer band's range comes from
// its sample format, a float band's from the data), so any numeric container
// works for the concatenation.
function concatenateAllBandValues(bands: ReadonlyArray<RasterTypedArray>): Float64Array {
  const totalLength = bands.reduce((sum, band) => sum + band.length, 0);
  const combined = new Float64Array(totalLength);
  let offset = 0;
  for (const band of bands) {
    combined.set(band, offset);
    offset += band.length;
  }
  return combined;
}

export function serializeThresholdOtsuCutoffsToJson(cutoffs: ThresholdOtsuCutoffs): string {
  return JSON.stringify({
    perBand: cutoffs.perBandBounds.map(boundsToPair),
    combined: boundsToPair(cutoffs.combinedBounds),
  });
}

export function parseThresholdOtsuCutoffsFromJson(json: string): ThresholdOtsuCutoffs {
  const parsed = JSON.parse(json) as {
    perBand: ReadonlyArray<readonly [number, number]>;
    combined: readonly [number, number];
  };
  return {
    perBandBounds: parsed.perBand.map(pairToBounds),
    combinedBounds: pairToBounds(parsed.combined),
  };
}

function boundsToPair(bounds: ThresholdBounds): readonly [number, number] {
  return [bounds.lower, bounds.upper];
}

function pairToBounds(pair: readonly [number, number]): ThresholdBounds {
  return { lower: pair[0], upper: pair[1] };
}
