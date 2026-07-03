import { describe, expect, it } from "vitest";

import { BINARY_STACK_BITS_PER_SAMPLE, makeBinaryStackFromBands } from "./binary-stack";

describe("makeBinaryStackFromBands", () => {
  it("builds one output band per input band", () => {
    const bands = [Uint8Array.from([0, 255, 0, 255]), Uint8Array.from([255, 255, 0, 0])];
    const stack = makeBinaryStackFromBands(bands, { width: 2, height: 2 });
    expect(stack.bandCount).toBe(2);
    expect(stack.bandPixels).toHaveLength(2);
    expect(Array.from(stack.bandPixels[0]!)).toEqual([0, 255, 0, 255]);
    expect(Array.from(stack.bandPixels[1]!)).toEqual([255, 255, 0, 0]);
  });

  it("stamps the 2-level 8-bit unsigned raster metadata", () => {
    const stack = makeBinaryStackFromBands([Uint8Array.from([0, 255])], { width: 2, height: 1 });
    expect(stack.sampleFormat).toBe("uint");
    expect(stack.bitsPerSample).toBe(BINARY_STACK_BITS_PER_SAMPLE);
    expect(stack.width).toBe(2);
    expect(stack.height).toBe(1);
    expect(stack.bandPixels[0]).toBeInstanceOf(Uint8Array);
  });

  it("carries explicit band labels through", () => {
    const stack = makeBinaryStackFromBands([Uint8Array.from([255])], {
      width: 1,
      height: 1,
      bandLabels: ["Band 3"],
    });
    expect(stack.bandLabels).toEqual(["Band 3"]);
  });

  it("rejects a band whose length does not match the spatial dimensions", () => {
    expect(() =>
      makeBinaryStackFromBands([Uint8Array.from([0, 255, 0])], { width: 2, height: 2 }),
    ).toThrow("2 x 2");
  });

  it("rejects an empty band list", () => {
    expect(() => makeBinaryStackFromBands([], { width: 1, height: 1 })).toThrow(
      "at least one band",
    );
  });
});
