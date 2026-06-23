import { describe, expect, it } from "vitest";

import {
  makeComponentStackFromProjection,
  readComponentStackSourceMeta,
} from "./transform-output";
import type { RasterImage } from "@/lib/image/raster-image";

function makeProjection(componentCount: number, sampleCount: number): Float32Array[] {
  return Array.from(
    { length: componentCount },
    (_, component) => new Float32Array(sampleCount).fill(component + 0.5),
  );
}

const SOURCE_META = { width: 2, height: 2, componentLabelPrefix: "PC" };

describe("makeComponentStackFromProjection", () => {
  it("builds a stack whose band count equals the kept-component count", () => {
    const stack = makeComponentStackFromProjection(makeProjection(3, 4), SOURCE_META);
    expect(stack.bandCount).toBe(3);
    expect(stack.bandPixels).toHaveLength(3);
  });

  it("preserves the source width and height", () => {
    const stack = makeComponentStackFromProjection(makeProjection(2, 4), SOURCE_META);
    expect(stack.width).toBe(2);
    expect(stack.height).toBe(2);
  });

  it("emits float32 samples", () => {
    const stack = makeComponentStackFromProjection(makeProjection(2, 4), SOURCE_META);
    expect(stack.sampleFormat).toBe("float");
    expect(stack.bitsPerSample).toBe(32);
    expect(stack.bandPixels[0]).toBeInstanceOf(Float32Array);
  });

  it("labels each component band with the configured prefix", () => {
    const stack = makeComponentStackFromProjection(makeProjection(2, 4), SOURCE_META);
    expect(stack.bandLabels).toEqual(["PC 1", "PC 2"]);
  });

  it("preserves the true projected values in the data", () => {
    const stack = makeComponentStackFromProjection(makeProjection(2, 4), SOURCE_META);
    expect(Array.from(stack.bandPixels[1]!)).toEqual([1.5, 1.5, 1.5, 1.5]);
  });
});

describe("readComponentStackSourceMeta", () => {
  it("carries the source dimensions and the label prefix", () => {
    const source = { width: 8, height: 4 } as RasterImage;
    expect(readComponentStackSourceMeta(source, "MNF")).toEqual({
      width: 8,
      height: 4,
      componentLabelPrefix: "MNF",
    });
  });
});
