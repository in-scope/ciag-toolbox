import { Layers } from "lucide-react";
import { describe, expect, it } from "vitest";

import type { CubeSampleMatrix } from "@/lib/image/dimension-reduction/cube-samples";
import type { ComponentProjection } from "@/lib/image/dimension-reduction/transform-output";
import type { RasterImage } from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

import {
  COMPONENT_COUNT_PARAMETER_ID,
  DIMENSION_REDUCTION_SOURCE_BAND_COUNT_PARAMETER_ID,
  registerDimensionReductionAction,
} from "./dimension-reduction-action";
import { DEFAULT_VIEWPORT_RENDERING_STATE } from "./viewport-action";

// A trivial "keep the first N bands" transform exercises the descriptor wiring
// (count resolution, float output, audit label) without any real fit math.
function keepLeadingBands(
  samples: CubeSampleMatrix,
  _fit: null,
  keptCount: number,
): ComponentProjection {
  return Array.from({ length: keptCount }, (_, index) => Float32Array.from(samples.bandValues[index]!));
}

const IDENTITY_CONFIG = {
  id: "test-dimension-reduction",
  label: "Test DR",
  icon: Layers,
  successMessage: "Test DR applied",
  componentLabelPrefix: "TC",
  fit: (): null => null,
  project: keepLeadingBands,
};

function makeFourBandRaster(): RasterImage {
  return {
    bandPixels: Array.from({ length: 4 }, (_, band) => new Uint16Array([band, band + 1, band + 2, band + 3])),
    width: 2,
    height: 2,
    bandCount: 4,
    bitsPerSample: 16,
    sampleFormat: "uint",
  };
}

function rasterSource(raster: RasterImage): ViewportImageSource {
  return { kind: "raster", raster };
}

describe("registerDimensionReductionAction", () => {
  it("exposes a single component-count parameter", () => {
    const action = registerDimensionReductionAction(IDENTITY_CONFIG);
    expect(action.parameters).toHaveLength(1);
    expect(action.parameters![0]!.kind).toBe("component-count");
    expect(action.parameters![0]!.id).toBe(COMPONENT_COUNT_PARAMETER_ID);
  });

  it("produces a float32 stack whose band count equals the kept-component count", () => {
    const action = registerDimensionReductionAction(IDENTITY_CONFIG);
    const result = action.transformSource!(rasterSource(makeFourBandRaster()), {
      [COMPONENT_COUNT_PARAMETER_ID]: 2,
    });
    expect(result.kind).toBe("raster");
    const raster = (result as { raster: RasterImage }).raster;
    expect(raster.bandCount).toBe(2);
    expect(raster.sampleFormat).toBe("float");
    expect(raster.bitsPerSample).toBe(32);
  });

  it("clamps a request above the band count down to the band count", () => {
    const action = registerDimensionReductionAction(IDENTITY_CONFIG);
    const result = action.transformSource!(rasterSource(makeFourBandRaster()), {
      [COMPONENT_COUNT_PARAMETER_ID]: 99,
    });
    expect((result as { raster: RasterImage }).raster.bandCount).toBe(4);
  });

  it("resolves and records the kept count and source band count for the audit trail", () => {
    const action = registerDimensionReductionAction(IDENTITY_CONFIG);
    const prepared = action.prepareParameterValuesForApply!(
      { [COMPONENT_COUNT_PARAMETER_ID]: 99 },
      DEFAULT_VIEWPORT_RENDERING_STATE,
      "whole-image",
      makeFourBandRaster(),
    );
    expect(prepared[COMPONENT_COUNT_PARAMETER_ID]).toBe(4);
    expect(prepared[DIMENSION_REDUCTION_SOURCE_BAND_COUNT_PARAMETER_ID]).toBe(4);
  });

  it("formats the applied label as 'X of N components'", () => {
    const action = registerDimensionReductionAction(IDENTITY_CONFIG);
    const label = action.formatAppliedLabel!({
      [COMPONENT_COUNT_PARAMETER_ID]: 3,
      [DIMENSION_REDUCTION_SOURCE_BAND_COUNT_PARAMETER_ID]: 12,
    });
    expect(label).toBe("Test DR (3 of 12 components)");
  });

  it("lets a transform supply per-component strength labels", () => {
    const action = registerDimensionReductionAction({
      ...IDENTITY_CONFIG,
      describeKeptComponentLabels: (_fit, keptCount) =>
        Array.from({ length: keptCount }, (_, index) => `TC ${index + 1} (strong)`),
    });
    const result = action.transformSource!(rasterSource(makeFourBandRaster()), {
      [COMPONENT_COUNT_PARAMETER_ID]: 2,
    });
    expect((result as { raster: RasterImage }).raster.bandLabels).toEqual([
      "TC 1 (strong)",
      "TC 2 (strong)",
    ]);
  });
});
