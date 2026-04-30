import { describe, expect, it } from "vitest";

import {
  compactAnchorAfterRemovingIndex,
  compactIndexedMapAfterRemovingIndex,
  compactIndexedSetAfterRemovingIndex,
} from "./compact-indexed-map";

describe("compactIndexedMapAfterRemovingIndex", () => {
  it("drops the removed index and shifts higher entries down by one", () => {
    const input = new Map<number, string>([
      [0, "a"],
      [1, "b"],
      [3, "d"],
    ]);
    const result = compactIndexedMapAfterRemovingIndex(input, 1);
    expect(Array.from(result.entries())).toEqual([
      [0, "a"],
      [2, "d"],
    ]);
  });

  it("leaves entries below the removed index untouched", () => {
    const input = new Map<number, number>([
      [0, 100],
      [2, 200],
    ]);
    const result = compactIndexedMapAfterRemovingIndex(input, 2);
    expect(Array.from(result.entries())).toEqual([[0, 100]]);
  });

  it("returns an empty map when the only entry is removed", () => {
    const input = new Map<number, string>([[0, "only"]]);
    const result = compactIndexedMapAfterRemovingIndex(input, 0);
    expect(result.size).toBe(0);
  });
});

describe("compactIndexedSetAfterRemovingIndex", () => {
  it("drops the removed index and shifts higher indices down by one", () => {
    const input = new Set<number>([0, 2, 4]);
    const result = compactIndexedSetAfterRemovingIndex(input, 2);
    expect(Array.from(result).sort()).toEqual([0, 3]);
  });

  it("returns an empty set when the only index is removed", () => {
    const input = new Set<number>([0]);
    const result = compactIndexedSetAfterRemovingIndex(input, 0);
    expect(result.size).toBe(0);
  });
});

describe("compactAnchorAfterRemovingIndex", () => {
  it("returns null when the anchor is the removed index", () => {
    expect(compactAnchorAfterRemovingIndex(2, 2)).toBeNull();
  });

  it("shifts a higher anchor down by one", () => {
    expect(compactAnchorAfterRemovingIndex(5, 2)).toBe(4);
  });

  it("leaves a lower anchor untouched", () => {
    expect(compactAnchorAfterRemovingIndex(1, 3)).toBe(1);
  });

  it("preserves a null anchor", () => {
    expect(compactAnchorAfterRemovingIndex(null, 0)).toBeNull();
  });
});
