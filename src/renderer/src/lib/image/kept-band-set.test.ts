import { describe, expect, it } from "vitest";

import {
  buildInitialKeptBandSetFromRemoved,
  listRemovedBandIndexesFromKeptSet,
  toggleBandIndexInKeptSet,
} from "./kept-band-set";

describe("buildInitialKeptBandSetFromRemoved", () => {
  it("keeps every band when nothing is removed", () => {
    const kept = buildInitialKeptBandSetFromRemoved(4, []);
    expect([...kept].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it("omits the removed indexes", () => {
    const kept = buildInitialKeptBandSetFromRemoved(5, [1, 3]);
    expect([...kept].sort((a, b) => a - b)).toEqual([0, 2, 4]);
  });
});

describe("listRemovedBandIndexesFromKeptSet", () => {
  it("returns the complement of the kept set in ascending order", () => {
    const kept = new Set([0, 3]);
    expect(listRemovedBandIndexesFromKeptSet(5, kept)).toEqual([1, 2, 4]);
  });

  it("returns an empty list when every band is kept", () => {
    const kept = new Set([0, 1, 2]);
    expect(listRemovedBandIndexesFromKeptSet(3, kept)).toEqual([]);
  });
});

describe("toggleBandIndexInKeptSet", () => {
  it("adds a missing index", () => {
    const next = toggleBandIndexInKeptSet(new Set([0, 2]), 1);
    expect([...next].sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  it("removes a present index", () => {
    const next = toggleBandIndexInKeptSet(new Set([0, 1, 2]), 1);
    expect([...next].sort((a, b) => a - b)).toEqual([0, 2]);
  });

  it("returns a new set, leaving the original untouched", () => {
    const original = new Set([0, 1]);
    const next = toggleBandIndexInKeptSet(original, 1);
    expect(original.has(1)).toBe(true);
    expect(next.has(1)).toBe(false);
  });
});
