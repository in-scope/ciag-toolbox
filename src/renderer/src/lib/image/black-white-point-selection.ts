export interface BlackWhitePointSelection {
  readonly black: number;
  readonly white: number;
}

export type BlackWhitePointMarker = "black" | "white";

const MIN_MARKER_SEPARATION_FRACTION = 1e-3;

export function defaultBlackWhitePointSelectionForRange(
  min: number,
  max: number,
): BlackWhitePointSelection {
  return { black: min, white: max };
}

export function resolveBlackWhitePointSelectionWithinRange(
  selection: BlackWhitePointSelection | null,
  min: number,
  max: number,
): BlackWhitePointSelection {
  if (!selection) return defaultBlackWhitePointSelectionForRange(min, max);
  const separation = markerSeparationForRange(min, max);
  const black = clampNumberToRange(selection.black, min, max - separation);
  const white = clampNumberToRange(selection.white, black + separation, max);
  return { black, white };
}

export function convertHistogramFractionToValue(
  fraction: number,
  min: number,
  max: number,
): number {
  return min + clampNumberToRange(fraction, 0, 1) * (max - min);
}

export function convertValueToHistogramFraction(
  value: number,
  min: number,
  max: number,
): number {
  if (max <= min) return 0;
  return clampNumberToRange((value - min) / (max - min), 0, 1);
}

export function moveBlackWhitePointMarkerToValue(
  selection: BlackWhitePointSelection,
  marker: BlackWhitePointMarker,
  value: number,
  min: number,
  max: number,
): BlackWhitePointSelection {
  const separation = markerSeparationForRange(min, max);
  if (marker === "black") {
    return { black: clampNumberToRange(value, min, selection.white - separation), white: selection.white };
  }
  return { black: selection.black, white: clampNumberToRange(value, selection.black + separation, max) };
}

function markerSeparationForRange(min: number, max: number): number {
  return Math.max(0, max - min) * MIN_MARKER_SEPARATION_FRACTION;
}

function clampNumberToRange(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
