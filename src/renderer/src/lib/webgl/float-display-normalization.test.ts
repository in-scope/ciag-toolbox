import { describe, expect, it } from "vitest";

import type { RgbChannelExtents } from "@/lib/image/compute-image-channel-extents";

import {
  autoStretchAppliesToFloatDisplayWindow,
  resolveEffectiveFloatDisplayNormalization,
  type NormalizationState,
} from "./float-display-normalization";

const OUT_OF_RANGE_EXTENTS: RgbChannelExtents = {
  min: [-0.5, -0.5, -0.5],
  max: [2, 2, 2],
};

function disabledNormalization(extents: RgbChannelExtents): NormalizationState {
  return { enabled: false, extents };
}

describe("autoStretchAppliesToFloatDisplayWindow", () => {
  it("auto-stretches out-of-range float only while the fixed-unit window is off", () => {
    expect(autoStretchAppliesToFloatDisplayWindow(true, false)).toBe(true);
  });

  it("does not auto-stretch once the fixed-unit window is on", () => {
    expect(autoStretchAppliesToFloatDisplayWindow(true, true)).toBe(false);
  });

  it("never auto-stretches in-range data regardless of the fixed-unit toggle", () => {
    expect(autoStretchAppliesToFloatDisplayWindow(false, false)).toBe(false);
    expect(autoStretchAppliesToFloatDisplayWindow(false, true)).toBe(false);
  });
});

describe("resolveEffectiveFloatDisplayNormalization", () => {
  it("stretches out-of-range float to its extents when auto-fit is on (default)", () => {
    const resolved = resolveEffectiveFloatDisplayNormalization(
      disabledNormalization(OUT_OF_RANGE_EXTENTS),
      true,
      false,
    );
    expect(resolved).toEqual({ enabled: true, extents: OUT_OF_RANGE_EXTENTS });
  });

  it("leaves the fixed [0,1] window (disabled) when auto-fit is off", () => {
    const resolved = resolveEffectiveFloatDisplayNormalization(
      disabledNormalization(OUT_OF_RANGE_EXTENTS),
      true,
      true,
    );
    expect(resolved.enabled).toBe(false);
  });

  it("honors an explicit normalized-viewing toggle even when the fixed-unit window is on", () => {
    const userEnabled: NormalizationState = { enabled: true, extents: OUT_OF_RANGE_EXTENTS };
    const resolved = resolveEffectiveFloatDisplayNormalization(userEnabled, true, true);
    expect(resolved).toBe(userEnabled);
  });

  it("leaves in-range float untouched whether or not the fixed-unit window is on", () => {
    const inRange = disabledNormalization({ min: [0, 0, 0], max: [1, 1, 1] });
    expect(resolveEffectiveFloatDisplayNormalization(inRange, false, false).enabled).toBe(false);
    expect(resolveEffectiveFloatDisplayNormalization(inRange, false, true).enabled).toBe(false);
  });
});
