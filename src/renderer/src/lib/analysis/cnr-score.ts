// CT-309: Contrast-to-Noise Ratio of one candidate band against two mask
// categories, computed exactly as the locked decision states:
// (mean of text pixels - mean of background pixels) / population standard
// deviation of background pixels (numpy std with ddof=0). The score is the ROP
// panel's cheapest objective, so it runs in TS over the candidate values the
// worker already returned instead of a second Python round trip.

export interface CnrScoreRequest {
  readonly candidateValues: Float32Array;
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
