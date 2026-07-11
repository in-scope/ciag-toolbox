import { describe, expect, it } from "vitest";

import {
  computeCombinedBandHistogramAcrossBands,
  sumBandHistogramsSharingOneRange,
  type CombinedBandHistogramInputs,
} from "@/lib/image/combined-band-histogram";
import {
  computeBandHistogramFromBandPixels,
  DEFAULT_BAND_HISTOGRAM_BIN_COUNT,
  type BandHistogram,
} from "@/lib/image/compute-band-histogram";
import type { RasterSampleFormat, RasterTypedArray } from "@/lib/image/raster-image";

// CT-219d equivalence: the accumulate-based combined histogram must be
// bin-for-bin identical to the old concatenate-then-tally path (rebuilt here
// as the test-only reference) on every sample format.

function concatenateBands(bands: ReadonlyArray<RasterTypedArray>): Float64Array {
  const totalLength = bands.reduce((sum, band) => sum + band.length, 0);
  const combined = new Float64Array(totalLength);
  let offset = 0;
  for (const band of bands) {
    combined.set(band, offset);
    offset += band.length;
  }
  return combined;
}

function buildInputs(
  bands: ReadonlyArray<RasterTypedArray>,
  sampleFormat: RasterSampleFormat,
  bitsPerSample: number,
): CombinedBandHistogramInputs {
  return { bands, sampleFormat, bitsPerSample, binCount: DEFAULT_BAND_HISTOGRAM_BIN_COUNT };
}

async function expectCombinedMatchesConcatenated(
  inputs: CombinedBandHistogramInputs,
): Promise<void> {
  const combined = await computeCombinedBandHistogramAcrossBands(inputs);
  const concatenated = computeBandHistogramFromBandPixels({
    pixels: concatenateBands(inputs.bands),
    sampleFormat: inputs.sampleFormat,
    bitsPerSample: inputs.bitsPerSample,
    binCount: inputs.binCount,
  });
  expect(combined).toEqual(concatenated);
}

describe("computeCombinedBandHistogramAcrossBands", () => {
  it("matches the concatenated tally for uint8 bands", async () => {
    await expectCombinedMatchesConcatenated(
      buildInputs(
        [Uint8Array.from([10, 10, 200, 200]), Uint8Array.from([50, 50, 220, 220])],
        "uint",
        8,
      ),
    );
  });

  it("matches the concatenated tally for uint16 bands", async () => {
    await expectCombinedMatchesConcatenated(
      buildInputs(
        [
          Uint16Array.from([0, 1000, 30000, 65535]),
          Uint16Array.from([500, 500, 40000, 60000]),
          Uint16Array.from([12345, 23456, 34567, 45678]),
        ],
        "uint",
        16,
      ),
    );
  });

  it("matches the concatenated tally for int16 bands with negative values", async () => {
    await expectCombinedMatchesConcatenated(
      buildInputs(
        [Int16Array.from([-32768, -100, 0, 200]), Int16Array.from([-5000, 300, 30000, 32767])],
        "int",
        16,
      ),
    );
  });

  it("matches the concatenated tally for float bands with differing extents", async () => {
    await expectCombinedMatchesConcatenated(
      buildInputs(
        [Float32Array.from([0, 0.5, 4, 4]), Float32Array.from([-2, -2, 9, 9.5])],
        "float",
        32,
      ),
    );
  });

  it("matches the concatenated tally for float bands with non-finite values", async () => {
    await expectCombinedMatchesConcatenated(
      buildInputs(
        [
          Float32Array.from([Number.NaN, 1, 2, Number.POSITIVE_INFINITY]),
          Float32Array.from([3, Number.NEGATIVE_INFINITY, 4, Number.NaN]),
        ],
        "float",
        32,
      ),
    );
  });

  it("matches the concatenated tally for a single float band", async () => {
    await expectCombinedMatchesConcatenated(
      buildInputs([Float32Array.from([1, 2, 3, 4])], "float", 32),
    );
  });

  it("matches the concatenated tally for an all-constant float stack", async () => {
    await expectCombinedMatchesConcatenated(
      buildInputs([Float32Array.from([7, 7]), Float32Array.from([7, 7])], "float", 32),
    );
  });

  it("matches the concatenated tally for a float stack with no finite values", async () => {
    await expectCombinedMatchesConcatenated(
      buildInputs([Float32Array.from([Number.NaN, Number.POSITIVE_INFINITY])], "float", 32),
    );
  });

  it("ticks once per band from 0 to 1", async () => {
    const fractions: number[] = [];
    await computeCombinedBandHistogramAcrossBands(
      buildInputs(
        [Uint8Array.from([1]), Uint8Array.from([2]), Uint8Array.from([3])],
        "uint",
        8,
      ),
      (fraction) => fractions.push(fraction),
    );
    expect(fractions).toEqual([0, 1 / 3, 2 / 3, 1]);
  });
});

describe("sumBandHistogramsSharingOneRange", () => {
  function histogramOf(pixels: RasterTypedArray): BandHistogram {
    return computeBandHistogramFromBandPixels({
      pixels,
      sampleFormat: "uint",
      bitsPerSample: 8,
      binCount: 4,
    });
  }

  it("sums bins and sample counts across histograms", () => {
    const summed = sumBandHistogramsSharingOneRange([
      histogramOf(Uint8Array.from([0, 0, 255])),
      histogramOf(Uint8Array.from([0, 128, 255])),
    ]);
    expect(Array.from(summed.bins)).toEqual([3, 0, 1, 2]);
    expect(summed.totalSampleCount).toBe(6);
  });

  it("rejects an empty histogram list", () => {
    expect(() => sumBandHistogramsSharingOneRange([])).toThrowError(
      /At least one band histogram/,
    );
  });

  it("rejects histograms with mismatched ranges", () => {
    const uint8Histogram = histogramOf(Uint8Array.from([0]));
    const floatHistogram = computeBandHistogramFromBandPixels({
      pixels: Float32Array.from([0, 1]),
      sampleFormat: "float",
      bitsPerSample: 32,
      binCount: 4,
    });
    expect(() => sumBandHistogramsSharingOneRange([uint8Histogram, floatHistogram])).toThrowError(
      /share one range/,
    );
  });
});
