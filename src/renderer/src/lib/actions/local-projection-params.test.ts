import { describe, expect, it } from "vitest";

import {
  buildLocalProjectionExecuteParams,
  buildLocalProjectionParameterSchemas,
  DEFAULT_LOCAL_PROJECTION_STEP,
  formatLocalProjectionAppliedLabel,
  LOCAL_PROJECTION_MEAN_CENTER_PARAMETER_ID,
  LOCAL_PROJECTION_RADIUS_PARAMETER_ID,
  LOCAL_PROJECTION_STEP_PARAMETER_ID,
  RADIUS_MATCHING_STEP,
  readLocalProjectionSettings,
  resolveLocalProjectionKernelRadius,
} from "./local-projection-params";

// CT-311: the panel must expose every tunable the client script's signature
// defines - localPCA(cube, pcaStep, radius = None, meanCenter = True) - each on
// the script's own default, because the pinned parity reference was produced by
// running the built-in with NO params at all.

describe("local projection parameter schemas", () => {
  it("offers stride, kernel radius, and the mean-centring switch", () => {
    const schemas = buildLocalProjectionParameterSchemas("Local PCA");
    expect(schemas.map((schema) => schema.id)).toEqual([
      LOCAL_PROJECTION_STEP_PARAMETER_ID,
      LOCAL_PROJECTION_RADIUS_PARAMETER_ID,
      LOCAL_PROJECTION_MEAN_CENTER_PARAMETER_ID,
    ]);
    expect(schemas.map((schema) => schema.label)).toEqual([
      "Stride",
      "Kernel radius",
      "Subtract local mean",
    ]);
  });

  it("defaults every field to the built-in script's own default", () => {
    const defaults = buildLocalProjectionParameterSchemas("Local PCA").map(
      (schema) => (schema as { defaultValue: unknown }).defaultValue,
    );
    expect(defaults).toEqual([DEFAULT_LOCAL_PROJECTION_STEP, RADIUS_MATCHING_STEP, true]);
  });

  it("names the operation in the stride description", () => {
    const [stride] = buildLocalProjectionParameterSchemas("Local MNF");
    expect(stride?.description).toContain("Local MNF");
  });
});

describe("readLocalProjectionSettings", () => {
  it("falls back to the script defaults when the panel has no values yet", () => {
    expect(readLocalProjectionSettings({})).toEqual({
      step: DEFAULT_LOCAL_PROJECTION_STEP,
      radius: null,
      meanCenter: true,
    });
  });

  it("reads a radius of 0 as the script's radius = None (match the stride)", () => {
    const settings = readLocalProjectionSettings({
      [LOCAL_PROJECTION_STEP_PARAMETER_ID]: 12,
      [LOCAL_PROJECTION_RADIUS_PARAMETER_ID]: RADIUS_MATCHING_STEP,
    });
    expect(settings.radius).toBeNull();
    expect(resolveLocalProjectionKernelRadius(settings)).toBe(12);
  });

  it("keeps an explicit radius independent of the stride", () => {
    const settings = readLocalProjectionSettings({
      [LOCAL_PROJECTION_STEP_PARAMETER_ID]: 200,
      [LOCAL_PROJECTION_RADIUS_PARAMETER_ID]: 100,
    });
    expect(settings.radius).toBe(100);
    expect(resolveLocalProjectionKernelRadius(settings)).toBe(100);
  });

  it("rounds fractional entries and never lets the stride fall below one pixel", () => {
    const settings = readLocalProjectionSettings({
      [LOCAL_PROJECTION_STEP_PARAMETER_ID]: -4,
      [LOCAL_PROJECTION_RADIUS_PARAMETER_ID]: 2.6,
    });
    expect(settings).toEqual({ step: 1, radius: 3, meanCenter: true });
  });

  it("reads the mean-centring switch", () => {
    const settings = readLocalProjectionSettings({
      [LOCAL_PROJECTION_MEAN_CENTER_PARAMETER_ID]: false,
    });
    expect(settings.meanCenter).toBe(false);
  });
});

describe("buildLocalProjectionExecuteParams", () => {
  it("sends the script's own parameter names, with null for the default radius", () => {
    expect(buildLocalProjectionExecuteParams(readLocalProjectionSettings({}))).toEqual({
      step: DEFAULT_LOCAL_PROJECTION_STEP,
      radius: null,
      meanCenter: true,
    });
  });

  it("sends an explicit radius through unchanged", () => {
    const settings = readLocalProjectionSettings({
      [LOCAL_PROJECTION_RADIUS_PARAMETER_ID]: 5,
      [LOCAL_PROJECTION_MEAN_CENTER_PARAMETER_ID]: false,
    });
    expect(buildLocalProjectionExecuteParams(settings)).toEqual({
      step: DEFAULT_LOCAL_PROJECTION_STEP,
      radius: 5,
      meanCenter: false,
    });
  });
});

describe("formatLocalProjectionAppliedLabel", () => {
  it("records the resolved kernel radius, not the 0 sentinel", () => {
    expect(formatLocalProjectionAppliedLabel("Local PCA", {})).toBe(
      "Local PCA (stride 8, kernel radius 8, local mean subtracted)",
    );
  });

  it("records an explicit radius and a disabled mean centring", () => {
    expect(
      formatLocalProjectionAppliedLabel("Local PCA", {
        [LOCAL_PROJECTION_STEP_PARAMETER_ID]: 200,
        [LOCAL_PROJECTION_RADIUS_PARAMETER_ID]: 100,
        [LOCAL_PROJECTION_MEAN_CENTER_PARAMETER_ID]: false,
      }),
    ).toBe("Local PCA (stride 200, kernel radius 100, no local mean subtraction)");
  });
});
