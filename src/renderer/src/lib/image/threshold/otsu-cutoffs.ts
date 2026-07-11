import {
  computeCombinedBandHistogramAcrossBands,
  sumBandHistogramsSharingOneRange,
} from "@/lib/image/combined-band-histogram";
import {
  computeBandHistogramFromRaster,
  DEFAULT_BAND_HISTOGRAM_BIN_COUNT,
  type BandHistogram,
} from "@/lib/image/compute-band-histogram";
import type { RasterImage } from "@/lib/image/raster-image";
import {
  computeArrayReportingPerUnitProgress,
  scaleProgressToWindow,
  type UnitProgressCallback,
} from "@/lib/image/unit-progress";

import { computeOtsuBoundsForHistogram } from "./otsu";
import type { ThresholdBounds } from "./threshold";

// CT-201: the Auto button derives an Otsu cutoff for EVERY band up front (plus
// one cutoff over the combined data), because the scope choice is only known
// at Apply time: band-wise thresholds each band with its own cutoff, while the
// combined full-stack scope uses the single cutoff over all bands together.
// The popup keeps showing just the current band's bounds; the full per-band
// list surfaces in the audit trail.
//
// CT-219d: the cutoffs are derived WITHOUT concatenating the stack (the old
// combined path copied every band into one Float64Array, ~6.1 GB at reference
// scale, and the allocation failure vanished inside the click handler). The
// combined histogram is the sum of per-band tallies over one shared range,
// which is bin-for-bin identical to a tally over the concatenation. Integer
// stacks reuse the per-band histograms outright (they already share the
// sample type's container range), so their combined cutoff costs no second
// sweep; float stacks re-tally each band into the combined value range. The
// sweep is async with one tick and a paint yield per band so the busy bar
// advances and the UI stays responsive.

export interface ThresholdOtsuCutoffs {
  readonly perBandBounds: ReadonlyArray<ThresholdBounds>;
  readonly combinedBounds: ThresholdBounds;
}

export async function computeOtsuCutoffsForRasterReportingProgress(
  raster: RasterImage,
  onProgress?: UnitProgressCallback,
): Promise<ThresholdOtsuCutoffs> {
  const needsCombinedSweep = raster.sampleFormat === "float";
  const perBandWindow = needsCombinedSweep ? scaleProgressToWindow(onProgress, 0, 0.5) : onProgress;
  const perBandHistograms = await computeEveryBandHistogramReportingProgress(raster, perBandWindow);
  return {
    perBandBounds: perBandHistograms.map(computeOtsuBoundsForHistogram),
    combinedBounds: await computeCombinedOtsuBounds(raster, perBandHistograms, onProgress),
  };
}

function computeEveryBandHistogramReportingProgress(
  raster: RasterImage,
  onProgress: UnitProgressCallback | undefined,
): Promise<BandHistogram[]> {
  return computeArrayReportingPerUnitProgress(
    raster.bandPixels.length,
    (bandIndex) => computeBandHistogramFromRaster(raster, bandIndex),
    onProgress,
  );
}

async function computeCombinedOtsuBounds(
  raster: RasterImage,
  perBandHistograms: ReadonlyArray<BandHistogram>,
  onProgress: UnitProgressCallback | undefined,
): Promise<ThresholdBounds> {
  if (raster.sampleFormat !== "float") {
    return computeOtsuBoundsForHistogram(sumBandHistogramsSharingOneRange(perBandHistograms));
  }
  const combined = await computeCombinedBandHistogramAcrossBands(
    {
      bands: raster.bandPixels,
      sampleFormat: raster.sampleFormat,
      bitsPerSample: raster.bitsPerSample,
      binCount: DEFAULT_BAND_HISTOGRAM_BIN_COUNT,
    },
    scaleProgressToWindow(onProgress, 0.5, 1),
  );
  return computeOtsuBoundsForHistogram(combined);
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
