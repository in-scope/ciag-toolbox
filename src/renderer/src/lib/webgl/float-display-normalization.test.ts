import { describe, expect, it } from "vitest";

import type { RgbChannelExtents } from "@/lib/image/compute-image-channel-extents";
import { VIEWPORT_FRAGMENT_SHADER_SOURCE } from "@/lib/webgl/shaders";

import {
  autoStretchAppliesToFloatDisplayWindow,
  floatSourceDataFallsOutsideUnitDisplayWindow,
  mapSampleThroughDisplayNormalization,
  quantizeDisplayUnitToByte,
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

// CT-296: the pure mirror of the shader's normalize/clamp block, shared by the
// as-viewed PNG/JPEG export. Expectations spell out what the shader produces.
describe("mapSampleThroughDisplayNormalization", () => {
  const DISABLED: NormalizationState = {
    enabled: false,
    extents: { min: [0.25, 0.25, 0.25], max: [0.75, 0.75, 0.75] },
  };
  const ENABLED: NormalizationState = {
    enabled: true,
    extents: { min: [0.25, 0, 0.5], max: [0.75, 1, 0.5] },
  };

  it("clamps to the fixed [0, 1] window when normalization is off", () => {
    expect(mapSampleThroughDisplayNormalization(-3, 0, DISABLED)).toBe(0);
    expect(mapSampleThroughDisplayNormalization(0.4, 0, DISABLED)).toBe(0.4);
    expect(mapSampleThroughDisplayNormalization(9, 0, DISABLED)).toBe(1);
  });

  it("stretches the channel's own extents to [0, 1] when normalization is on", () => {
    expect(mapSampleThroughDisplayNormalization(0.25, 0, ENABLED)).toBe(0);
    expect(mapSampleThroughDisplayNormalization(0.5, 0, ENABLED)).toBe(0.5);
    expect(mapSampleThroughDisplayNormalization(0.75, 0, ENABLED)).toBe(1);
  });

  it("reads the extents of the channel it is given", () => {
    expect(mapSampleThroughDisplayNormalization(0.5, 1, ENABLED)).toBe(0.5);
  });

  it("divides a flat channel by one instead of by zero, giving black", () => {
    expect(mapSampleThroughDisplayNormalization(0.5, 2, ENABLED)).toBe(0);
  });

  it("clamps samples outside the stretched window", () => {
    expect(mapSampleThroughDisplayNormalization(0.1, 0, ENABLED)).toBe(0);
    expect(mapSampleThroughDisplayNormalization(0.9, 0, ENABLED)).toBe(1);
  });

  it("maps a NaN sample to black rather than letting it through", () => {
    expect(mapSampleThroughDisplayNormalization(Number.NaN, 0, DISABLED)).toBe(0);
  });
});

describe("quantizeDisplayUnitToByte", () => {
  it("rounds to nearest like the GPU's fixed-point conversion", () => {
    expect(quantizeDisplayUnitToByte(0)).toBe(0);
    expect(quantizeDisplayUnitToByte(1)).toBe(255);
    expect(quantizeDisplayUnitToByte(0.5)).toBe(128);
    expect(quantizeDisplayUnitToByte(1 / 3)).toBe(85);
  });

  it("clamps out-of-window values", () => {
    expect(quantizeDisplayUnitToByte(-1)).toBe(0);
    expect(quantizeDisplayUnitToByte(4)).toBe(255);
  });
});

describe("floatSourceDataFallsOutsideUnitDisplayWindow", () => {
  const floatSource = {
    kind: "raster",
    raster: {
      width: 1,
      height: 1,
      bitsPerSample: 32,
      sampleFormat: "float",
      bandCount: 1,
      bandPixels: [new Float32Array([0])],
    },
  } as const;

  it("reports true when any channel leaves [0, 1]", () => {
    expect(floatSourceDataFallsOutsideUnitDisplayWindow(floatSource, OUT_OF_RANGE_EXTENTS)).toBe(true);
  });

  it("reports false for in-range float data", () => {
    expect(
      floatSourceDataFallsOutsideUnitDisplayWindow(floatSource, { min: [0, 0, 0], max: [1, 1, 1] }),
    ).toBe(false);
  });

  it("reports false for an integer raster whatever its extents", () => {
    const integerSource = {
      kind: "raster",
      raster: { ...floatSource.raster, sampleFormat: "uint", bitsPerSample: 16 },
    } as const;
    expect(floatSourceDataFallsOutsideUnitDisplayWindow(integerSource, OUT_OF_RANGE_EXTENTS)).toBe(
      false,
    );
  });
});

// CT-296: mapSampleThroughDisplayNormalization is a CPU MIRROR of GLSL that
// cannot be shared literally, so this pins the shader block it mirrors. If the
// shader's normalize/clamp math is ever edited, this fails and points at the
// mirror that has to move with it.
describe("the shader block the CPU mirror reproduces", () => {
  it("still stretches by a zero-safe range and clamps, exactly as mirrored", () => {
    expect(VIEWPORT_FRAGMENT_SHADER_SOURCE).toContain(
      [
        "    vec3 range = u_normalizeMaxColor - u_normalizeMinColor;",
        "    bvec3 hasRange = greaterThan(range, vec3(0.0));",
        "    vec3 safeRange = mix(vec3(1.0), range, hasRange);",
        "    rgb = clamp((rgb - u_normalizeMinColor) / safeRange, 0.0, 1.0);",
      ].join("\n"),
    );
  });

  it("still clamps to the fixed [0, 1] window when normalization is off", () => {
    expect(VIEWPORT_FRAGMENT_SHADER_SOURCE).toContain("    rgb = clamp(rgb, 0.0, 1.0);");
  });
});
