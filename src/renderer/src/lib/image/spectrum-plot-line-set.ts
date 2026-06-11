export interface SpectrumPlotLine {
  readonly id: string;
  readonly colorClass: string;
  readonly values: ReadonlyArray<number>;
  readonly bandStandardDeviations?: ReadonlyArray<number>;
  readonly strokeDasharray?: string;
}

export const LIVE_HOVER_SPECTRUM_LINE_ID = "spectrum-live-hover";
export const LIVE_HOVER_SPECTRUM_COLOR_CLASS = "text-muted-foreground";
export const LIVE_HOVER_SPECTRUM_DASHARRAY = "3 3";

export interface SpectrumPlotLineSetInput {
  readonly pinnedLines: ReadonlyArray<SpectrumPlotLine>;
  readonly hoverBandValues: ReadonlyArray<number> | null;
}

export function buildSpectrumPlotLineSetWithLiveHover(
  input: SpectrumPlotLineSetInput,
): SpectrumPlotLine[] {
  const lines = [...input.pinnedLines];
  const hoverLine = buildLiveHoverSpectrumLineOrNull(input.hoverBandValues);
  if (hoverLine) lines.push(hoverLine);
  return lines;
}

export function buildLiveHoverSpectrumLineOrNull(
  hoverBandValues: ReadonlyArray<number> | null,
): SpectrumPlotLine | null {
  if (!hoverBandValues || hoverBandValues.length === 0) return null;
  return {
    id: LIVE_HOVER_SPECTRUM_LINE_ID,
    colorClass: LIVE_HOVER_SPECTRUM_COLOR_CLASS,
    values: hoverBandValues,
    strokeDasharray: LIVE_HOVER_SPECTRUM_DASHARRAY,
  };
}
