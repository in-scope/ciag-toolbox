import { describe, expect, it } from "vitest";

import {
  buildLiveHoverSpectrumLineOrNull,
  buildSpectrumPlotLineSetWithLiveHover,
  LIVE_HOVER_SPECTRUM_DASHARRAY,
  LIVE_HOVER_SPECTRUM_LINE_ID,
  type SpectrumPlotLine,
} from "@/lib/image/spectrum-plot-line-set";

const PINNED_LINES: ReadonlyArray<SpectrumPlotLine> = [
  { id: "pinned-1", colorClass: "text-sky-400", values: [1, 2, 3] },
  { id: "pinned-2", colorClass: "text-amber-400", values: [4, 5, 6] },
];

describe("buildLiveHoverSpectrumLineOrNull (CT-092)", () => {
  it("builds a distinct dashed live line from hovered band values", () => {
    const line = buildLiveHoverSpectrumLineOrNull([7, 8, 9]);
    expect(line).not.toBeNull();
    expect(line!.id).toBe(LIVE_HOVER_SPECTRUM_LINE_ID);
    expect(line!.values).toEqual([7, 8, 9]);
    expect(line!.strokeDasharray).toBe(LIVE_HOVER_SPECTRUM_DASHARRAY);
  });

  it("returns null when there are no hovered band values", () => {
    expect(buildLiveHoverSpectrumLineOrNull(null)).toBeNull();
    expect(buildLiveHoverSpectrumLineOrNull([])).toBeNull();
  });
});

describe("buildSpectrumPlotLineSetWithLiveHover (CT-092)", () => {
  it("appends the live hover line after the pinned lines while hovering", () => {
    const lines = buildSpectrumPlotLineSetWithLiveHover({
      pinnedLines: PINNED_LINES,
      hoverBandValues: [7, 8, 9],
    });
    expect(lines.map((line) => line.id)).toEqual([
      "pinned-1",
      "pinned-2",
      LIVE_HOVER_SPECTRUM_LINE_ID,
    ]);
  });

  it("renders only the pinned lines when nothing is hovered", () => {
    const lines = buildSpectrumPlotLineSetWithLiveHover({
      pinnedLines: PINNED_LINES,
      hoverBandValues: null,
    });
    expect(lines.map((line) => line.id)).toEqual(["pinned-1", "pinned-2"]);
  });

  it("keeps the live hover line visually distinct from every pinned line", () => {
    const lines = buildSpectrumPlotLineSetWithLiveHover({
      pinnedLines: PINNED_LINES,
      hoverBandValues: [7, 8, 9],
    });
    const hoverLine = lines.find((line) => line.id === LIVE_HOVER_SPECTRUM_LINE_ID);
    expect(hoverLine?.strokeDasharray).toBe(LIVE_HOVER_SPECTRUM_DASHARRAY);
    expect(PINNED_LINES.some((line) => line.strokeDasharray)).toBe(false);
  });

  it("can preview a live spectrum even before anything is pinned", () => {
    const lines = buildSpectrumPlotLineSetWithLiveHover({
      pinnedLines: [],
      hoverBandValues: [7, 8, 9],
    });
    expect(lines.map((line) => line.id)).toEqual([LIVE_HOVER_SPECTRUM_LINE_ID]);
  });
});
