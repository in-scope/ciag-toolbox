import { describe, expect, it } from "vitest";

import { OperationStoppedError } from "./operation-stop";
import {
  computeArrayReportingPerUnitProgress,
  runInChunksReportingProgress,
  scaleProgressToWindow,
  throttleProgressToMinimumStep,
} from "./unit-progress";

describe("throttleProgressToMinimumStep (CT-225)", () => {
  it("drops fractions that advance less than the minimum step", () => {
    const reported: number[] = [];
    const throttled = throttleProgressToMinimumStep((fraction) => reported.push(fraction), 0.1)!;
    for (const fraction of [0.01, 0.05, 0.11, 0.15, 0.22, 0.29, 0.33]) throttled(fraction);
    expect(reported).toEqual([0.01, 0.11, 0.22, 0.33]);
  });

  it("always passes a fraction of exactly 1 so completion is never swallowed", () => {
    const reported: number[] = [];
    const throttled = throttleProgressToMinimumStep((fraction) => reported.push(fraction), 0.5)!;
    throttled(0.99);
    throttled(1);
    expect(reported).toEqual([0.99, 1]);
  });

  it("returns undefined when there is no callback to throttle", () => {
    expect(throttleProgressToMinimumStep(undefined, 0.1)).toBeUndefined();
  });
});

describe("scaleProgressToWindow", () => {
  it("maps a phase's 0..1 fraction into its window of the overall bar", () => {
    const reported: number[] = [];
    const windowed = scaleProgressToWindow((fraction) => reported.push(fraction), 0.5, 1)!;
    windowed(0);
    windowed(0.5);
    windowed(1);
    expect(reported).toEqual([0.5, 0.75, 1]);
  });
});

describe("computeArrayReportingPerUnitProgress", () => {
  it("computes every unit and ticks a leading zero plus one fraction per unit", async () => {
    const ticks: number[] = [];
    const results = await computeArrayReportingPerUnitProgress(
      3,
      (index) => index * 10,
      (fraction) => ticks.push(fraction),
    );
    expect(results).toEqual([0, 10, 20]);
    expect(ticks).toEqual([0, 1 / 3, 2 / 3, 1]);
  });
});

describe("runInChunksReportingProgress (CT-226)", () => {
  it("processes every unit in order and ticks after each chunk", async () => {
    const processed: Array<[number, number]> = [];
    const ticks: number[] = [];
    await runInChunksReportingProgress(
      10,
      4,
      (start, end) => processed.push([start, end]),
      (fraction) => ticks.push(fraction),
    );
    expect(processed).toEqual([[0, 4], [4, 8], [8, 10]]);
    expect(ticks).toEqual([0.4, 0.8, 1]);
  });

  it("clamps a fractional or sub-1 chunk size up to one unit", async () => {
    const processed: Array<[number, number]> = [];
    await runInChunksReportingProgress(3, 0.2, (start, end) => processed.push([start, end]));
    expect(processed).toEqual([[0, 1], [1, 2], [2, 3]]);
  });
});

describe("chunk boundaries double as stop checkpoints (CT-268)", () => {
  it("computeArrayReportingPerUnitProgress cancels a sweep at the boundary after the abort", async () => {
    const controller = new AbortController();
    const computed: number[] = [];
    const sweep = computeArrayReportingPerUnitProgress(
      5,
      (index) => {
        computed.push(index);
        if (index === 1) controller.abort();
        return index;
      },
      () => undefined,
      controller.signal,
    );
    await expect(sweep).rejects.toBeInstanceOf(OperationStoppedError);
    expect(computed).toEqual([0, 1]);
  });

  it("runInChunksReportingProgress cancels between chunks and never runs the next chunk", async () => {
    const controller = new AbortController();
    const processedStarts: number[] = [];
    const sweep = runInChunksReportingProgress(
      10,
      2,
      (start) => {
        processedStarts.push(start);
        if (start === 2) controller.abort();
      },
      undefined,
      controller.signal,
    );
    await expect(sweep).rejects.toBeInstanceOf(OperationStoppedError);
    expect(processedStarts).toEqual([0, 2]);
  });

  it("an unaborted signal changes nothing", async () => {
    const controller = new AbortController();
    const results = await computeArrayReportingPerUnitProgress(
      3,
      (index) => index * 2,
      undefined,
      controller.signal,
    );
    expect(results).toEqual([0, 2, 4]);
  });
});
