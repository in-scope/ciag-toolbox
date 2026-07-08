import { afterEach, describe, expect, it } from "vitest";

import { CUSTOM_TRANSFORM_ACTION } from "./custom-transform-action";
import { DEFAULT_VIEWPORT_RENDERING_STATE } from "./viewport-action";
import { buildFormulaCubeTransformState } from "@/lib/image/band-ops/cube-transform-editing";
import {
  forgetAllCubeTransformResults,
  rememberCubeTransformResult,
} from "@/lib/image/band-ops/cube-transform-result-store";
import type { RasterImage } from "@/lib/image/raster-image";

afterEach(() => forgetAllCubeTransformResults());

function makeThreeBandUint16Raster(): RasterImage {
  return {
    bandPixels: [Uint16Array.from([100, 101]), Uint16Array.from([800, 801]), Uint16Array.from([1600, 1601])],
    width: 2,
    height: 1,
    bandCount: 3,
    sampleFormat: "uint",
    bitsPerSample: 16,
    bandLabels: ["One", "Two", "Three"],
    bandWavelengths: [450, 550, 650],
  };
}

function rememberCube(bands: Float32Array[]): string {
  return rememberCubeTransformResult({ shape: [bands.length, 1, 2], bands });
}

function prepareWithRememberedBands(bands: Float32Array[], description = "cube * 2") {
  const token = rememberCube(bands);
  const state = {
    ...DEFAULT_VIEWPORT_RENDERING_STATE,
    cubeTransform: buildFormulaCubeTransformState(token, bands.length, description),
  };
  return CUSTOM_TRANSFORM_ACTION.prepareParameterValuesForApply!({}, state, "whole-image");
}

function applyTransformToRaster(prepared: ReturnType<typeof prepareWithRememberedBands>): RasterImage {
  const result = CUSTOM_TRANSFORM_ACTION.transformSource!(
    { kind: "raster", raster: makeThreeBandUint16Raster() },
    prepared,
  ) as { raster: RasterImage };
  return result.raster;
}

describe("CUSTOM_TRANSFORM_ACTION", () => {
  it("rejects Apply when the editor has not produced a transform yet", () => {
    expect(() =>
      CUSTOM_TRANSFORM_ACTION.prepareParameterValuesForApply!({}, DEFAULT_VIEWPORT_RENDERING_STATE, "whole-image"),
    ).toThrow(/run a formula or import a tool/i);
  });

  it("builds a float32 stack from the remembered cube and carries metadata through on a matching band count", () => {
    const prepared = prepareWithRememberedBands([
      Float32Array.from([200, 202]),
      Float32Array.from([1600, 1602]),
      Float32Array.from([3200, 3202]),
    ]);
    const raster = applyTransformToRaster(prepared);
    expect(raster.bandCount).toBe(3);
    expect(raster.sampleFormat).toBe("float");
    expect(Array.from(raster.bandPixels[0]!)).toEqual([200, 202]);
    expect(raster.bandLabels).toEqual(["One", "Two", "Three"]);
    expect(raster.bandWavelengths).toEqual([450, 550, 650]);
  });

  it("accepts a changed band count and drops labels and wavelengths for the generic identity", () => {
    const prepared = prepareWithRememberedBands([
      Float32Array.from([700, 700]),
      Float32Array.from([800, 800]),
    ]);
    const raster = applyTransformToRaster(prepared);
    expect(raster.bandCount).toBe(2);
    expect(raster.bandLabels).toBeUndefined();
    expect(raster.bandWavelengths).toBeUndefined();
  });

  it("rejects a remembered cube whose spatial dimensions mismatch the applied-to source", () => {
    const token = rememberCubeTransformResult({
      shape: [1, 2, 2],
      bands: [Float32Array.from([1, 2, 3, 4])],
    });
    const state = {
      ...DEFAULT_VIEWPORT_RENDERING_STATE,
      cubeTransform: buildFormulaCubeTransformState(token, 1, "cube[:1]"),
    };
    const prepared = CUSTOM_TRANSFORM_ACTION.prepareParameterValuesForApply!({}, state, "whole-image");
    expect(() => applyTransformToRaster(prepared)).toThrow(/keep the source height and width/i);
  });

  it("throws a clear error when the remembered transform token is gone", () => {
    const state = {
      ...DEFAULT_VIEWPORT_RENDERING_STATE,
      cubeTransform: buildFormulaCubeTransformState("cube-transform-missing", 3, "cube * 2"),
    };
    const prepared = CUSTOM_TRANSFORM_ACTION.prepareParameterValuesForApply!({}, state, "whole-image");
    expect(() => applyTransformToRaster(prepared)).toThrow(/no longer available/i);
  });

  it("records the formula expression in the applied label", () => {
    const prepared = prepareWithRememberedBands([Float32Array.from([0, 0])], "np.diff(cube, axis=0)");
    expect(CUSTOM_TRANSFORM_ACTION.formatAppliedLabel!(prepared)).toBe(
      "Custom transform (np.diff(cube, axis=0))",
    );
  });

  it("resets band-dependent viewer state and clears the consumed choice after applying", () => {
    const state = {
      ...DEFAULT_VIEWPORT_RENDERING_STATE,
      selectedBandIndex: 2,
      cubeTransform: buildFormulaCubeTransformState("t", 2, "cube * 2"),
    };
    const next = CUSTOM_TRANSFORM_ACTION.apply(state, {});
    expect(next.selectedBandIndex).toBe(0);
    expect(next.cubeTransform).toBeNull();
  });
});
