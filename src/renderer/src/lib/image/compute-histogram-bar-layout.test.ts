import { describe, expect, it } from "vitest";

import { computeHistogramBarHorizontalSpan } from "@/lib/image/compute-histogram-bar-layout";

function collectAllBarSpans(barCount: number, widthPx: number) {
  return Array.from({ length: barCount }, (_unused, index) =>
    computeHistogramBarHorizontalSpan(index, barCount, widthPx),
  );
}

describe("computeHistogramBarHorizontalSpan", () => {
  it("tiles bars with no gaps when bar width is fractional (CT-065 missing-stripe repro)", () => {
    const spans = collectAllBarSpans(256, 400);
    for (let index = 1; index < spans.length; index++) {
      const previous = spans[index - 1]!;
      const current = spans[index]!;
      expect(current.left).toBe(previous.left + previous.width);
    }
  });

  it("covers the full canvas width from the first pixel to the last", () => {
    const spans = collectAllBarSpans(256, 400);
    expect(spans[0]!.left).toBe(0);
    const last = spans[spans.length - 1]!;
    expect(last.left + last.width).toBe(400);
  });

  it("uses integer pixel edges so adjacent bars never antialias into a gap", () => {
    for (const span of collectAllBarSpans(173, 511)) {
      expect(Number.isInteger(span.left)).toBe(true);
      expect(Number.isInteger(span.width)).toBe(true);
    }
  });

  it("gives each bar at least one pixel of width when bins outnumber pixels", () => {
    for (const span of collectAllBarSpans(512, 200)) {
      expect(span.width).toBeGreaterThanOrEqual(1);
    }
  });

  it("draws exact two-pixel bars when the canvas is a clean multiple of the bin count", () => {
    const spans = collectAllBarSpans(128, 256);
    expect(spans[0]).toEqual({ left: 0, width: 2 });
    expect(spans[1]).toEqual({ left: 2, width: 2 });
  });
});
