export interface SpectrumPlotPadding {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface SpectrumPlotDimensions {
  readonly width: number;
  readonly height: number;
  readonly padding: SpectrumPlotPadding;
}

export interface SpectrumPlotValueRange {
  readonly minValue: number;
  readonly maxValue: number;
}

export interface SpectrumPlotXRange {
  readonly minPosition: number;
  readonly maxPosition: number;
}

export const DEFAULT_SPECTRUM_PLOT_PADDING: SpectrumPlotPadding = Object.freeze({
  top: 8,
  right: 8,
  bottom: 24,
  left: 36,
});

export function computeSpectrumPlotXRange(
  bandPositions: ReadonlyArray<number>,
): SpectrumPlotXRange {
  if (bandPositions.length === 0) return { minPosition: 0, maxPosition: 1 };
  const minPosition = Math.min(...bandPositions);
  const maxPosition = Math.max(...bandPositions);
  if (minPosition === maxPosition) {
    return { minPosition: minPosition - 1, maxPosition: maxPosition + 1 };
  }
  return { minPosition, maxPosition };
}

export function computeSpectrumPlotValueRange(
  valueLists: ReadonlyArray<ReadonlyArray<number>>,
): SpectrumPlotValueRange {
  let minValue = Number.POSITIVE_INFINITY;
  let maxValue = Number.NEGATIVE_INFINITY;
  for (const values of valueLists) {
    for (const value of values) {
      if (!Number.isFinite(value)) continue;
      if (value < minValue) minValue = value;
      if (value > maxValue) maxValue = value;
    }
  }
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) return { minValue: 0, maxValue: 1 };
  if (minValue === maxValue) return { minValue: minValue - 1, maxValue: maxValue + 1 };
  return { minValue, maxValue };
}

export function projectXPositionToPixelX(
  position: number,
  xRange: SpectrumPlotXRange,
  dimensions: SpectrumPlotDimensions,
): number {
  const innerWidth = dimensions.width - dimensions.padding.left - dimensions.padding.right;
  if (innerWidth <= 0) return dimensions.padding.left;
  const span = xRange.maxPosition - xRange.minPosition;
  if (span === 0) return dimensions.padding.left;
  const fraction = (position - xRange.minPosition) / span;
  return dimensions.padding.left + fraction * innerWidth;
}

export function projectYValueToPixelY(
  value: number,
  valueRange: SpectrumPlotValueRange,
  dimensions: SpectrumPlotDimensions,
): number {
  const innerHeight = dimensions.height - dimensions.padding.top - dimensions.padding.bottom;
  if (innerHeight <= 0) return dimensions.padding.top;
  const span = valueRange.maxValue - valueRange.minValue;
  if (span === 0) return dimensions.padding.top + innerHeight / 2;
  const fraction = (value - valueRange.minValue) / span;
  return dimensions.padding.top + (1 - fraction) * innerHeight;
}

export function buildSpectrumLinePathFromValues(
  bandPositions: ReadonlyArray<number>,
  values: ReadonlyArray<number>,
  xRange: SpectrumPlotXRange,
  valueRange: SpectrumPlotValueRange,
  dimensions: SpectrumPlotDimensions,
): string {
  const segments: string[] = [];
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    const position = bandPositions[index];
    if (value === undefined || position === undefined || !Number.isFinite(value)) continue;
    const x = projectXPositionToPixelX(position, xRange, dimensions);
    const y = projectYValueToPixelY(value, valueRange, dimensions);
    segments.push(`${segments.length === 0 ? "M" : "L"}${formatCoordinate(x)} ${formatCoordinate(y)}`);
  }
  return segments.join(" ");
}

export function buildSpectrumStandardDeviationBandPath(
  bandPositions: ReadonlyArray<number>,
  bandMeans: ReadonlyArray<number>,
  bandStandardDeviations: ReadonlyArray<number>,
  xRange: SpectrumPlotXRange,
  valueRange: SpectrumPlotValueRange,
  dimensions: SpectrumPlotDimensions,
): string {
  const upper = collectBandRibbonPoints(
    bandPositions,
    bandMeans,
    bandStandardDeviations,
    1,
    xRange,
    valueRange,
    dimensions,
  );
  const lowerForward = collectBandRibbonPoints(
    bandPositions,
    bandMeans,
    bandStandardDeviations,
    -1,
    xRange,
    valueRange,
    dimensions,
  );
  const lower = [...lowerForward].reverse();
  if (upper.length === 0 || lower.length === 0) return "";
  return `M${upper[0]} ${appendLineSegments(upper.slice(1))} L${lower.join(" L")} Z`;
}

function appendLineSegments(points: ReadonlyArray<string>): string {
  return points.map((point) => `L${point}`).join(" ");
}

function collectBandRibbonPoints(
  bandPositions: ReadonlyArray<number>,
  bandMeans: ReadonlyArray<number>,
  bandStandardDeviations: ReadonlyArray<number>,
  multiplier: 1 | -1,
  xRange: SpectrumPlotXRange,
  valueRange: SpectrumPlotValueRange,
  dimensions: SpectrumPlotDimensions,
): ReadonlyArray<string> {
  const points: string[] = [];
  for (let index = 0; index < bandMeans.length; index++) {
    const mean = bandMeans[index];
    const stddev = bandStandardDeviations[index] ?? 0;
    const position = bandPositions[index];
    if (mean === undefined || position === undefined || !Number.isFinite(mean)) continue;
    const ribbonValue = mean + multiplier * stddev;
    const x = projectXPositionToPixelX(position, xRange, dimensions);
    const y = projectYValueToPixelY(ribbonValue, valueRange, dimensions);
    points.push(`${formatCoordinate(x)} ${formatCoordinate(y)}`);
  }
  return points;
}

function formatCoordinate(value: number): string {
  return Number(value.toFixed(2)).toString();
}
