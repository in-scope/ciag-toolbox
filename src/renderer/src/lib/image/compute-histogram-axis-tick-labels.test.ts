import { describe, expect, it } from "vitest";

import {
  computeHistogramAxisTickLabels,
  computeHistogramCountAxisTickLabels,
} from "@/lib/image/compute-histogram-axis-tick-labels";

const WIDE_AXIS_WIDTH_PX = 300;

describe("computeHistogramAxisTickLabels", () => {
  it("labels min at the left edge and max at the right edge for unsigned data", () => {
    const ticks = computeHistogramAxisTickLabels({ min: 0, max: 65535 }, "uint", WIDE_AXIS_WIDTH_PX);
    expect(ticks).toEqual([
      { value: 0, text: "0", fraction: 0, anchor: "start" },
      { value: 65535, text: "65535", fraction: 1, anchor: "end" },
    ]);
  });

  it("keeps exactly the min and max labels for a uint16 range at any width", () => {
    for (const widthPx of [0, 40, 90, 300, 10000]) {
      const ticks = computeHistogramAxisTickLabels({ min: 0, max: 65535 }, "uint", widthPx);
      expect(ticks.map((tick) => tick.value)).toEqual([0, 65535]);
    }
  });

  it("adds a centered zero tick when signed data spans zero on a wide axis", () => {
    const ticks = computeHistogramAxisTickLabels(
      { min: -32768, max: 32767 },
      "int",
      WIDE_AXIS_WIDTH_PX,
    );
    expect(ticks.map((tick) => tick.value)).toEqual([-32768, 0, 32767]);
    const zeroTick = ticks[1]!;
    expect(zeroTick.anchor).toBe("middle");
    expect(zeroTick.fraction).toBeCloseTo(0.5, 4);
  });

  it("drops the zero tick of Anna's float range on a 90 px axis and shows it at 300 px", () => {
    const range = { min: -0.5964, max: 0.6402 };
    const narrow = computeHistogramAxisTickLabels(range, "float", 90);
    expect(narrow.map((tick) => tick.text)).toEqual(["-0.5964", "0.6402"]);
    const wide = computeHistogramAxisTickLabels(range, "float", 300);
    expect(wide.map((tick) => tick.text)).toEqual(["-0.5964", "0", "0.6402"]);
  });

  it("pins the 8 px clearance boundary exactly", () => {
    const range = { min: -100, max: 100 };
    const atExactlyEightPxClearance = computeHistogramAxisTickLabels(range, "int", 79);
    expect(atExactlyEightPxClearance.map((tick) => tick.value)).toEqual([-100, 0, 100]);
    const oneBelowEightPxClearance = computeHistogramAxisTickLabels(range, "int", 78);
    expect(oneBelowEightPxClearance.map((tick) => tick.value)).toEqual([-100, 100]);
  });

  it("omits the zero tick when zero sits too close to the min edge", () => {
    const ticks = computeHistogramAxisTickLabels(
      { min: -5, max: 65535 },
      "int",
      WIDE_AXIS_WIDTH_PX,
    );
    expect(ticks.map((tick) => tick.value)).toEqual([-5, 65535]);
  });

  it("omits the zero tick for all-positive ranges", () => {
    const ticks = computeHistogramAxisTickLabels(
      { min: 10, max: 250 },
      "uint",
      WIDE_AXIS_WIDTH_PX,
    );
    expect(ticks.map((tick) => tick.value)).toEqual([10, 250]);
  });

  it("formats float ranges to four significant figures and shows a bare zero tick", () => {
    const ticks = computeHistogramAxisTickLabels(
      { min: -0.5, max: 0.25 },
      "float",
      WIDE_AXIS_WIDTH_PX,
    );
    expect(ticks.map((tick) => tick.text)).toEqual(["-0.5000", "0", "0.2500"]);
  });

  it("renders a large float value magnitude with a superscript exponent", () => {
    const ticks = computeHistogramAxisTickLabels(
      { min: 0, max: 70000.5 },
      "float",
      WIDE_AXIS_WIDTH_PX,
    );
    expect(ticks[1]!.text).toBe("7.000×10⁴");
  });
});

describe("computeHistogramCountAxisTickLabels", () => {
  it("labels the peak count at the top and zero at the baseline", () => {
    const ticks = computeHistogramCountAxisTickLabels(Uint32Array.from([3, 250000, 12]));
    expect(ticks).toEqual([
      { count: 250000, text: "2.5×10⁵", fraction: 1 },
      { count: 0, text: "0", fraction: 0 },
    ]);
  });

  it("collapses to a single zero label for an all-empty histogram", () => {
    const ticks = computeHistogramCountAxisTickLabels(Uint32Array.from([0, 0, 0]));
    expect(ticks).toEqual([{ count: 0, text: "0", fraction: 0 }]);
  });
});
