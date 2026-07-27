// CT-220: the human-readable counterpart of BusyEntry.progress (a 0..1 fraction).
// Rendered next to the determinate progress bar in busy-indicators.tsx.
export function formatBusyProgressPercentText(progressFraction: number): string {
  return `${Math.round(clampPercentToDisplayRange(progressFraction * 100))}%`;
}

function clampPercentToDisplayRange(percent: number): number {
  if (Number.isNaN(percent) || percent < 0) return 0;
  if (percent > 100) return 100;
  return percent;
}
