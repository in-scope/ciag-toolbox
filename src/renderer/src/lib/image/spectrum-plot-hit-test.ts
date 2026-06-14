import {
  projectXPositionToPixelX,
  projectYValueToPixelY,
  type SpectrumPlotDimensions,
  type SpectrumPlotValueRange,
  type SpectrumPlotXRange,
} from "@/lib/image/spectrum-plot-geometry";

export interface SpectrumHitTestLine {
  readonly id: string;
  readonly values: ReadonlyArray<number>;
  readonly bandStandardDeviations?: ReadonlyArray<number>;
}

export interface SpectrumLineValueHit {
  readonly lineId: string;
  readonly value: number;
  readonly standardDeviation: number | null;
}

export function findNearestBandIndexForPointerX(
  pointerX: number,
  bandPositions: ReadonlyArray<number>,
  xRange: SpectrumPlotXRange,
  dimensions: SpectrumPlotDimensions,
): number | null {
  let nearestIndex: number | null = null;
  let smallestDistance = Number.POSITIVE_INFINITY;
  bandPositions.forEach((position, index) => {
    const distance = Math.abs(projectXPositionToPixelX(position, xRange, dimensions) - pointerX);
    if (distance >= smallestDistance) return;
    smallestDistance = distance;
    nearestIndex = index;
  });
  return nearestIndex;
}

export function resolveNearestSpectrumLineAtBand(
  lines: ReadonlyArray<SpectrumHitTestLine>,
  bandIndex: number,
  pointerY: number,
  valueRange: SpectrumPlotValueRange,
  dimensions: SpectrumPlotDimensions,
): SpectrumLineValueHit | null {
  let nearestHit: SpectrumLineValueHit | null = null;
  let smallestDistance = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    const hit = readLineValueHitAtBandOrNull(line, bandIndex);
    if (hit === null) continue;
    const distance = Math.abs(projectYValueToPixelY(hit.value, valueRange, dimensions) - pointerY);
    if (distance >= smallestDistance) continue;
    smallestDistance = distance;
    nearestHit = hit;
  }
  return nearestHit;
}

function readLineValueHitAtBandOrNull(
  line: SpectrumHitTestLine,
  bandIndex: number,
): SpectrumLineValueHit | null {
  const value = line.values[bandIndex];
  if (value === undefined || !Number.isFinite(value)) return null;
  return { lineId: line.id, value, standardDeviation: readBandStandardDeviationOrNull(line, bandIndex) };
}

function readBandStandardDeviationOrNull(
  line: SpectrumHitTestLine,
  bandIndex: number,
): number | null {
  const standardDeviation = line.bandStandardDeviations?.[bandIndex];
  if (standardDeviation === undefined || !Number.isFinite(standardDeviation)) return null;
  return standardDeviation;
}
