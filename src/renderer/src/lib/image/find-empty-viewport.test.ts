import { describe, expect, it } from "vitest";

import {
  findLowestIndexEmptyViewport,
  listOccupiedViewportEntries,
} from "@/lib/image/find-empty-viewport";

describe("findLowestIndexEmptyViewport", () => {
  it("returns 0 when the map is empty", () => {
    expect(findLowestIndexEmptyViewport(new Map(), 4)).toBe(0);
  });

  it("returns the first hole when the lower indices are occupied", () => {
    const occupied = new Map([
      [0, "a"],
      [1, "b"],
      [3, "d"],
    ]);
    expect(findLowestIndexEmptyViewport(occupied, 4)).toBe(2);
  });

  it("returns null when every cell up to cellCount is occupied", () => {
    const full = new Map([
      [0, "a"],
      [1, "b"],
      [2, "c"],
      [3, "d"],
    ]);
    expect(findLowestIndexEmptyViewport(full, 4)).toBeNull();
  });

  it("ignores entries at indices >= cellCount when reporting full", () => {
    const occupied = new Map([
      [0, "a"],
      [1, "b"],
      [4, "out-of-range"],
    ]);
    expect(findLowestIndexEmptyViewport(occupied, 4)).toBe(2);
  });

  it("returns null when cellCount is zero", () => {
    expect(findLowestIndexEmptyViewport(new Map(), 0)).toBeNull();
  });
});

describe("listOccupiedViewportEntries", () => {
  it("returns entries in row-major order with file names extracted", () => {
    const occupied = new Map([
      [2, { fileName: "third.png" }],
      [0, { fileName: "first.png" }],
      [1, { fileName: "second.png" }],
    ]);
    const entries = listOccupiedViewportEntries(occupied, 4, (content) => content.fileName);
    expect(entries).toEqual([
      { index: 0, fileName: "first.png" },
      { index: 1, fileName: "second.png" },
      { index: 2, fileName: "third.png" },
    ]);
  });

  it("excludes entries at indices >= cellCount", () => {
    const occupied = new Map([
      [0, { fileName: "in-range.png" }],
      [3, { fileName: "out-of-range.png" }],
    ]);
    const entries = listOccupiedViewportEntries(occupied, 2, (content) => content.fileName);
    expect(entries).toEqual([{ index: 0, fileName: "in-range.png" }]);
  });
});
