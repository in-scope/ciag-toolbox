import { describe, expect, it } from "vitest";

import { buildRopKeepAction, ROP_KEEP_ACTION_ID } from "./rop-keep-action";

const SOURCE = { kind: "image-bitmap", bitmap: {} } as unknown as Parameters<
  NonNullable<ReturnType<typeof buildRopKeepAction>["transformSource"]>
>[0];

describe("buildRopKeepAction", () => {
  it("builds a one-band float32 stack from the candidate values, ignoring the source", () => {
    const action = buildRopKeepAction({
      seed: 7,
      values: Float32Array.from([1, 2, 3, 4]),
      width: 2,
      height: 2,
      score: null,
      objectiveLabel: null,
    });
    const result = action.transformSource?.(SOURCE, {});
    expect(result?.kind).toBe("raster");
    if (result?.kind !== "raster") return;
    expect(result.raster).toMatchObject({ width: 2, height: 2, bandCount: 1, sampleFormat: "float" });
    expect(Array.from(result.raster.bandPixels[0] ?? [])).toEqual([1, 2, 3, 4]);
  });

  it("copies the candidate values so the kept stack never shares the panel's buffer", () => {
    const values = Float32Array.from([1, 2]);
    const action = buildRopKeepAction({
      seed: 7,
      values,
      width: 2,
      height: 1,
      score: null,
      objectiveLabel: null,
    });
    const result = action.transformSource?.(SOURCE, {});
    if (result?.kind !== "raster") throw new Error("expected a raster result");
    expect(result.raster.bandPixels[0]?.buffer).not.toBe(values.buffer);
  });

  it("records the seed (and the objective score when present) in the History label", () => {
    const unscored = buildRopKeepAction({
      seed: 20260822,
      values: Float32Array.from([0]),
      width: 1,
      height: 1,
      score: null,
      objectiveLabel: null,
    });
    const scored = buildRopKeepAction({
      seed: 20260822,
      values: Float32Array.from([0]),
      width: 1,
      height: 1,
      score: 0.25,
      objectiveLabel: "CNR",
    });
    expect(unscored.appliedLabel).toBe("ROP (seed 20260822)");
    expect(scored.appliedLabel).toBe("ROP (seed 20260822, CNR: 0.2500)");
    expect(scored.id).toBe(ROP_KEEP_ACTION_ID);
    expect(scored.label).toBe("ROP");
  });

  it("leaves the rendering state untouched on apply", () => {
    const action = buildRopKeepAction({
      seed: 1,
      values: Float32Array.from([0]),
      width: 1,
      height: 1,
      score: null,
      objectiveLabel: null,
    });
    const state = { marker: true } as unknown as Parameters<typeof action.apply>[0];
    expect(action.apply(state, {})).toBe(state);
  });
});
