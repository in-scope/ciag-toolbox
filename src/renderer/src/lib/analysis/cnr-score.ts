import type { RasterImage, RasterTypedArray } from "@/lib/image/raster-image";

// CT-309: Contrast-to-Noise Ratio of one candidate band against two mask
// categories, computed exactly as the locked decision states:
// (mean of text pixels - mean of background pixels) / population standard
// deviation of background pixels (numpy std with ddof=0). The score is the ROP
// panel's cheapest objective, so it runs in TS over the candidate values the
// worker already returned instead of a second Python round trip.
//
// CT-320: CNR is also a Multi-band tool of its own, scoring every band of a
// stack on its own, so a band is any RasterTypedArray (a uint16 cube band as
// readily as a float32 candidate) and the per-band list is built from the ONE
// request shape below, which the analysis flow reuses band by band.

export interface CnrScoreRequest {
  readonly candidateValues: RasterTypedArray;
  readonly maskValues: Uint8Array;
  readonly textCategoryValue: number;
  readonly backgroundCategoryValue: number;
}

export function computeCnrScore(request: CnrScoreRequest): number {
  assertMaskCoversCandidate(request);
  const text = summarizeCategoryPixels(request, request.textCategoryValue);
  const background = summarizeCategoryPixels(request, request.backgroundCategoryValue);
  return (text.mean - background.mean) / populationStandardDeviation(background);
}

function assertMaskCoversCandidate(request: CnrScoreRequest): void {
  if (request.maskValues.length !== request.candidateValues.length) {
    throw new Error("The mask layer does not cover the candidate band.");
  }
}

interface CategoryPixelSummary {
  readonly mean: number;
  readonly sumOfSquaredDeviations: number;
  readonly count: number;
}

function summarizeCategoryPixels(
  request: CnrScoreRequest,
  categoryValue: number,
): CategoryPixelSummary {
  const mean = meanOfCategoryPixels(request, categoryValue);
  let sumOfSquaredDeviations = 0;
  let count = 0;
  for (let index = 0; index < request.maskValues.length; index += 1) {
    if (request.maskValues[index] !== categoryValue) continue;
    const deviation = (request.candidateValues[index] ?? 0) - mean;
    sumOfSquaredDeviations += deviation * deviation;
    count += 1;
  }
  return { mean, sumOfSquaredDeviations, count };
}

function meanOfCategoryPixels(request: CnrScoreRequest, categoryValue: number): number {
  let sum = 0;
  let count = 0;
  for (let index = 0; index < request.maskValues.length; index += 1) {
    if (request.maskValues[index] !== categoryValue) continue;
    sum += request.candidateValues[index] ?? 0;
    count += 1;
  }
  if (count === 0) throw new Error("A CNR category has no painted pixels.");
  return sum / count;
}

// numpy population std: ddof = 0, so the divisor is the plain pixel count.
function populationStandardDeviation(summary: CategoryPixelSummary): number {
  return Math.sqrt(summary.sumOfSquaredDeviations / summary.count);
}

// One request per band, in band order: the flow walks this list so it can
// yield between bands, and computeCnrScorePerBand maps it in one go.
export function listCnrScoreRequestsPerBand(
  raster: RasterImage,
  maskValues: Uint8Array,
  textCategoryValue: number,
  backgroundCategoryValue: number,
): ReadonlyArray<CnrScoreRequest> {
  return raster.bandPixels.map((candidateValues) => ({
    candidateValues,
    maskValues,
    textCategoryValue,
    backgroundCategoryValue,
  }));
}

export function computeCnrScorePerBand(
  raster: RasterImage,
  maskValues: Uint8Array,
  textCategoryValue: number,
  backgroundCategoryValue: number,
): ReadonlyArray<number> {
  return listCnrScoreRequestsPerBand(
    raster,
    maskValues,
    textCategoryValue,
    backgroundCategoryValue,
  ).map(computeCnrScore);
}
