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

export function computeHistogramBarFillSpan(
  barIndex: number,
  barCount: number,
  widthPx: number,
  shouldOverlapNextBar: boolean,
): HistogramBarHorizontalSpan {
  const base = computeHistogramBarHorizontalSpan(barIndex, barCount, widthPx);
  if (!shouldOverlapNextBar) return base;
  const overlappedRight = Math.min(widthPx, base.left + base.width + 1);
  return { left: base.left, width: Math.max(1, overlappedRight - base.left) };
}
