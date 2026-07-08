// CT-220: determinate progress for multi-unit image decodes. A unit is one page of a
// multi-page TIFF or one band of an ENVI cube; the fraction is completed units / total
// units. The yield between units lets the busy indicator paint and progress updates
// flush (the pattern documented in state/CLAUDE.md).
export type DecodeUnitProgressCallback = (fraction: number) => void;

export function reportMultiUnitDecodeStarting(
  onProgress: DecodeUnitProgressCallback | undefined,
  totalUnits: number,
): void {
  if (!onProgress || totalUnits <= 1) return;
  onProgress(0);
}

export async function reportCompletedDecodeUnitAndYieldSoProgressCanPaint(
  onProgress: DecodeUnitProgressCallback | undefined,
  completedUnits: number,
  totalUnits: number,
): Promise<void> {
  if (!onProgress) return;
  onProgress(completedUnits / Math.max(1, totalUnits));
  await yieldOnceSoTheBusyIndicatorCanPaint();
}

function yieldOnceSoTheBusyIndicatorCanPaint(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
