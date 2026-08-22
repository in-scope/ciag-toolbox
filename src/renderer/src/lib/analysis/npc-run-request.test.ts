import { describe, expect, it } from "vitest";

import { addCategoryToLayer, createMaskLayer, type MaskLayer } from "@/lib/masks/mask-layer";

import {
  DEFAULT_NPC_BIN_COUNT,
  buildNpcCategoryMasks,
  buildNpcRunExtras,
  clampNpcBinCount,
  parseNpcBinCountOrNull,
} from "./npc-run-request";

function buildLayerPaintedWith(painted: ReadonlyArray<number>): MaskLayer {
  const layer = addCategoryToLayer(createMaskLayer("mask-1", "Parchment mask", 2, 2));
  return { ...layer, values: Uint8Array.from(painted) };
}

describe("parseNpcBinCountOrNull", () => {
  it("accepts a whole number at or above the minimum", () => {
    expect(parseNpcBinCountOrNull("255")).toBe(255);
    expect(parseNpcBinCountOrNull(" 2 ")).toBe(2);
  });

  it("refuses anything that is not a usable bin count", () => {
    for (const text of ["", "1", "0", "-4", "2.5", "abc", "1e3"]) {
      expect(parseNpcBinCountOrNull(text)).toBeNull();
    }
  });
});

describe("clampNpcBinCount", () => {
  it("floors a fractional count and lifts anything under the minimum", () => {
    expect(clampNpcBinCount(64.9)).toBe(64);
    expect(clampNpcBinCount(1)).toBe(2);
  });

  it("falls back to the default for a non-finite count", () => {
    expect(clampNpcBinCount(Number.NaN)).toBe(DEFAULT_NPC_BIN_COUNT);
  });
});

describe("buildNpcCategoryMasks", () => {
  it("emits one binary mask per painted category, in category order", () => {
    const masks = buildNpcCategoryMasks(buildLayerPaintedWith([1, 2, 1, 0]));
    expect(masks).toHaveLength(2);
    expect(Array.from(masks[0] ?? [])).toEqual([1, 0, 1, 0]);
    expect(Array.from(masks[1] ?? [])).toEqual([0, 1, 0, 0]);
  });

  it("skips a declared but unpainted category so the script sees no empty mask", () => {
    const masks = buildNpcCategoryMasks(buildLayerPaintedWith([1, 0, 3, 0]));
    expect(masks).toHaveLength(2);
    expect(Array.from(masks[1] ?? [])).toEqual([0, 0, 1, 0]);
  });
});

describe("buildNpcRunExtras", () => {
  it("carries the category masks and the bins parameter the built-in script reads", () => {
    const extras = buildNpcRunExtras(buildLayerPaintedWith([1, 2, 0, 0]), 255);
    expect(extras.masks).toHaveLength(2);
    expect(extras.params).toEqual({ bins: 255 });
  });

  it("never sends a bin count the script would reject", () => {
    expect(buildNpcRunExtras(buildLayerPaintedWith([1, 2, 0, 0]), 1).params).toEqual({ bins: 2 });
  });
});
