import { describe, expect, it } from "vitest";

import {
  isBandsRowKeyboardKey,
  pickNextActiveBandIndexForKey,
} from "./bands-row-keyboard";

describe("pickNextActiveBandIndexForKey", () => {
  it("moves one row up on ArrowUp", () => {
    expect(pickNextActiveBandIndexForKey("ArrowUp", 3, 5)).toBe(2);
  });

  it("moves one row down on ArrowDown", () => {
    expect(pickNextActiveBandIndexForKey("ArrowDown", 1, 5)).toBe(2);
  });

  it("returns null when ArrowUp would go below zero", () => {
    expect(pickNextActiveBandIndexForKey("ArrowUp", 0, 5)).toBeNull();
  });

  it("returns null when ArrowDown would exceed the last index", () => {
    expect(pickNextActiveBandIndexForKey("ArrowDown", 4, 5)).toBeNull();
  });

  it("jumps to the first index on Home", () => {
    expect(pickNextActiveBandIndexForKey("Home", 3, 5)).toBe(0);
  });

  it("returns null on Home when already at the first index", () => {
    expect(pickNextActiveBandIndexForKey("Home", 0, 5)).toBeNull();
  });

  it("jumps to the last index on End", () => {
    expect(pickNextActiveBandIndexForKey("End", 1, 5)).toBe(4);
  });

  it("returns null on End when already at the last index", () => {
    expect(pickNextActiveBandIndexForKey("End", 4, 5)).toBeNull();
  });

  it("clamps an out-of-range current index before moving", () => {
    expect(pickNextActiveBandIndexForKey("ArrowDown", -5, 5)).toBe(1);
    expect(pickNextActiveBandIndexForKey("ArrowUp", 10, 5)).toBe(3);
  });
});

describe("isBandsRowKeyboardKey", () => {
  it("recognises the four supported keys", () => {
    expect(isBandsRowKeyboardKey("ArrowUp")).toBe(true);
    expect(isBandsRowKeyboardKey("ArrowDown")).toBe(true);
    expect(isBandsRowKeyboardKey("Home")).toBe(true);
    expect(isBandsRowKeyboardKey("End")).toBe(true);
  });

  it("rejects other keys", () => {
    expect(isBandsRowKeyboardKey("Tab")).toBe(false);
    expect(isBandsRowKeyboardKey("Enter")).toBe(false);
    expect(isBandsRowKeyboardKey(" ")).toBe(false);
  });
});
