export interface HistogramBarHorizontalSpan {
  readonly left: number;
  readonly width: number;
}

export function computeHistogramBarHorizontalSpan(
  barIndex: number,
  barCount: number,
  widthPx: number,
): HistogramBarHorizontalSpan {
  const left = floorBarEdge(barIndex, barCount, widthPx);
  const right = floorBarEdge(barIndex + 1, barCount, widthPx);
  return { left, width: Math.max(1, right - left) };
}

function floorBarEdge(edgeIndex: number, barCount: number, widthPx: number): number {
  return Math.floor((edgeIndex / barCount) * widthPx);
}
