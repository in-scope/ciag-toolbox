import { describe, expect, it } from "vitest";

import { computeHistogramAxisTickLabels } from "@/lib/image/compute-histogram-axis-tick-labels";

describe("computeHistogramAxisTickLabels", () => {
  it("labels min at the left edge and max at the right edge for unsigned data", () => {
    const ticks = computeHistogramAxisTickLabels({ min: 0, max: 65535 }, "uint");
    expect(ticks).toEqual([
      { value: 0, text: "0", fraction: 0, anchor: "start" },
      { value: 65535, text: "65535", fraction: 1, anchor: "end" },
    ]);
  });

  it("adds a centered zero tick when signed data spans zero", () => {
    const ticks = computeHistogramAxisTickLabels({ min: -32768, max: 32767 }, "int");
    expect(ticks.map((tick) => tick.value)).toEqual([-32768, 0, 32767]);
    const zeroTick = ticks[1]!;
    expect(zeroTick.anchor).toBe("middle");
    expect(zeroTick.fraction).toBeCloseTo(0.5, 4);
  });

  it("omits the zero tick when zero sits too close to the min edge", () => {
    const ticks = computeHistogramAxisTickLabels({ min: -5, max: 65535 }, "int");
    expect(ticks.map((tick) => tick.value)).toEqual([-5, 65535]);
  });

  it("omits the zero tick for all-positive ranges", () => {
    const ticks = computeHistogramAxisTickLabels({ min: 10, max: 250 }, "uint");
    expect(ticks.map((tick) => tick.value)).toEqual([10, 250]);
  });

  it("formats float ranges to four significant figures and shows a bare zero tick", () => {
    const ticks = computeHistogramAxisTickLabels({ min: -0.5, max: 0.25 }, "float");
    expect(ticks.map((tick) => tick.text)).toEqual(["-0.5000", "0", "0.2500"]);
  });
});
