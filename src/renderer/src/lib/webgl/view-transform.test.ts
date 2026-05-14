import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_USER_ZOOM,
  MIN_USER_ZOOM,
  clampUserZoom,
  computeMaxUserZoom,
} from "./view-transform";

describe("MIN_USER_ZOOM", () => {
  it("allows pulling 25% out beyond fit-to-viewport", () => {
    expect(MIN_USER_ZOOM).toBe(0.75);
  });
});

describe("computeMaxUserZoom", () => {
  it("returns the default cap for a small image in a large viewport", () => {
    const max = computeMaxUserZoom({ width: 100, height: 100 }, { width: 800, height: 800 });
    expect(max).toBe(DEFAULT_MAX_USER_ZOOM);
  });

  it("scales with image-to-viewport ratio so big images can reach 32 canvas px per image px", () => {
    const max = computeMaxUserZoom({ width: 11608, height: 8708 }, { width: 500, height: 500 });
    const expected = 32 / (500 / 11608);
    expect(max).toBeCloseTo(expected, 5);
    expect(max).toBeGreaterThan(700);
  });

  it("uses the limiting dimension of fit-to-viewport when image and viewport differ in aspect", () => {
    const max = computeMaxUserZoom({ width: 4000, height: 100 }, { width: 800, height: 800 });
    expect(max).toBeCloseTo(32 / (800 / 4000), 5);
  });

  it("falls back to the default cap when image or display has zero area", () => {
    expect(computeMaxUserZoom({ width: 0, height: 100 }, { width: 800, height: 800 })).toBe(
      DEFAULT_MAX_USER_ZOOM,
    );
    expect(computeMaxUserZoom({ width: 100, height: 100 }, { width: 0, height: 800 })).toBe(
      DEFAULT_MAX_USER_ZOOM,
    );
  });
});

describe("clampUserZoom", () => {
  it("clamps zoom below MIN_USER_ZOOM up to the floor", () => {
    expect(clampUserZoom(0.1, { width: 100, height: 100 }, { width: 500, height: 500 })).toBe(
      MIN_USER_ZOOM,
    );
  });

  it("clamps zoom above the dynamic cap down to the cap", () => {
    const image = { width: 11608, height: 8708 };
    const display = { width: 500, height: 500 };
    const cap = computeMaxUserZoom(image, display);
    expect(clampUserZoom(cap * 10, image, display)).toBe(cap);
  });

  it("returns the input zoom unchanged when it is inside the allowed range", () => {
    expect(clampUserZoom(4, { width: 100, height: 100 }, { width: 500, height: 500 })).toBe(4);
  });
});
