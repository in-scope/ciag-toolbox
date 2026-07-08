import { Layers } from "lucide-react";
import { describe, expect, it } from "vitest";

import type { CubeSampleMatrix } from "@/lib/image/dimension-reduction/cube-samples";
import type { ComponentProjection } from "@/lib/image/dimension-reduction/transform-output";
import type { RasterImage } from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

import {
  COMPONENT_COUNT_PARAMETER_ID,
  DIMENSION_REDUCTION_FIT_SCOPE_PARAMETER_ID,
  DIMENSION_REDUCTION_SOURCE_BAND_COUNT_PARAMETER_ID,
  registerDimensionReductionAction,
  ROI_FIT_SCOPE,
  WHOLE_IMAGE_FIT_SCOPE,
} from "./dimension-reduction-action";
import { PCA_ACTION } from "./pca-action";
import { DEFAULT_VIEWPORT_RENDERING_STATE } from "./viewport-action";
import type { ViewportRoi } from "@/lib/image/viewport-roi";

// A trivial "keep the first N bands" transform exercises the descriptor wiring
// (count resolution, float output, audit label) without any real fit math.
async function keepLeadingBands(
  samples: CubeSampleMatrix,
  _fit: null,
  keptCount: number,
): Promise<ComponentProjection> {
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

function stateWithOperationRegion(operationRegion: ViewportRoi) {
  return { ...DEFAULT_VIEWPORT_RENDERING_STATE, operationRegion };
}

describe("registerDimensionReductionAction", () => {
  it("exposes a single component-count parameter", () => {
    const action = registerDimensionReductionAction(IDENTITY_CONFIG);
    expect(action.parameters).toHaveLength(1);
    expect(action.parameters![0]!.kind).toBe("component-count");
    expect(action.parameters![0]!.id).toBe(COMPONENT_COUNT_PARAMETER_ID);
  });

  it("produces a float32 stack whose band count equals the kept-component count", async () => {
    const action = registerDimensionReductionAction(IDENTITY_CONFIG);
    const result = await action.transformSourceAsync!(rasterSource(makeFourBandRaster()), {
      [COMPONENT_COUNT_PARAMETER_ID]: 2,
    });
    expect(result.kind).toBe("raster");
    const raster = (result as { raster: RasterImage }).raster;
    expect(raster.bandCount).toBe(2);
    expect(raster.sampleFormat).toBe("float");
    expect(raster.bitsPerSample).toBe(32);
  });

  it("clamps a request above the band count down to the band count", async () => {
    const action = registerDimensionReductionAction(IDENTITY_CONFIG);
    const result = await action.transformSourceAsync!(rasterSource(makeFourBandRaster()), {
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

  it("opts into the shared ROI scope so the 'Whole image | ROI' radio appears", () => {
    expect(registerDimensionReductionAction(IDENTITY_CONFIG).supportsRoiScope).toBe(true);
  });

  it("records whole-image scope when apply scope is whole-image", () => {
    const action = registerDimensionReductionAction(IDENTITY_CONFIG);
    const prepared = action.prepareParameterValuesForApply!(
      { [COMPONENT_COUNT_PARAMETER_ID]: 2 },
      DEFAULT_VIEWPORT_RENDERING_STATE,
      "whole-image",
      makeFourBandRaster(),
    );
    expect(prepared[DIMENSION_REDUCTION_FIT_SCOPE_PARAMETER_ID]).toBe(WHOLE_IMAGE_FIT_SCOPE);
    expect(prepared.fitRegionImagePixelX0).toBeUndefined();
  });

  it("records the ROI scope and bounds when apply scope is roi", () => {
    const action = registerDimensionReductionAction(IDENTITY_CONFIG);
    const prepared = action.prepareParameterValuesForApply!(
      { [COMPONENT_COUNT_PARAMETER_ID]: 2 },
      stateWithOperationRegion({ imagePixelX0: 0, imagePixelY0: 0, imagePixelX1: 1, imagePixelY1: 1 }),
      "roi",
      makeFourBandRaster(),
    );
    expect(prepared[DIMENSION_REDUCTION_FIT_SCOPE_PARAMETER_ID]).toBe(ROI_FIT_SCOPE);
    expect(prepared.fitRegionImagePixelX1).toBe(1);
    expect(prepared.fitRegionImagePixelY1).toBe(1);
  });

  it("throws when ROI scope is chosen but no region was selected", () => {
    const action = registerDimensionReductionAction(IDENTITY_CONFIG);
    expect(() =>
      action.prepareParameterValuesForApply!(
        { [COMPONENT_COUNT_PARAMETER_ID]: 2 },
        DEFAULT_VIEWPORT_RENDERING_STATE,
        "roi",
        makeFourBandRaster(),
      ),
    ).toThrow(/region/i);
  });

  it("fits on only the in-ROI pixels yet still projects the whole cube", async () => {
    let fitSampleCount = -1;
    let projectSampleCount = -1;
    const action = registerDimensionReductionAction({
      ...IDENTITY_CONFIG,
      fit: (samples): null => {
        fitSampleCount = samples.sampleCount;
        return null;
      },
      project: (samples, _fit, keptCount) => {
        projectSampleCount = samples.sampleCount;
        return keepLeadingBands(samples, null, keptCount);
      },
    });
    await action.transformSourceAsync!(rasterSource(makeFourBandRaster()), {
      [COMPONENT_COUNT_PARAMETER_ID]: 2,
      fitRegionImagePixelX0: 0,
      fitRegionImagePixelY0: 0,
      fitRegionImagePixelX1: 0,
      fitRegionImagePixelY1: 0,
    });
    expect(fitSampleCount).toBe(1);
    expect(projectSampleCount).toBe(4);
  });

  it("notes the ROI bounds in the applied label", () => {
    const action = registerDimensionReductionAction(IDENTITY_CONFIG);
    const label = action.formatAppliedLabel!({
      [COMPONENT_COUNT_PARAMETER_ID]: 2,
      [DIMENSION_REDUCTION_SOURCE_BAND_COUNT_PARAMETER_ID]: 4,
      fitRegionImagePixelX0: 0,
      fitRegionImagePixelY0: 0,
      fitRegionImagePixelX1: 1,
      fitRegionImagePixelY1: 1,
    });
    expect(label).toBe("Test DR (2 of 4 components) fit on ROI (0, 0) - (1, 1)");
  });

  it("lets a transform supply per-component strength labels", async () => {
    const action = registerDimensionReductionAction({
      ...IDENTITY_CONFIG,
      describeKeptComponentLabels: (_fit, keptCount) =>
        Array.from({ length: keptCount }, (_, index) => `TC ${index + 1} (strong)`),
    });
    const result = await action.transformSourceAsync!(rasterSource(makeFourBandRaster()), {
      [COMPONENT_COUNT_PARAMETER_ID]: 2,
    });
    expect((result as { raster: RasterImage }).raster.bandLabels).toEqual([
      "TC 1 (strong)",
      "TC 2 (strong)",
    ]);
  });
});

// CT-223: the transform reports coarse phase progress (0, fit samples extracted,
// fit complete, projection samples extracted) then one tick per projected
// component across the second half of the bar.
describe("dimension-reduction phase progress (CT-223)", () => {
  it("reports the phase ticks then one tick per projected component", async () => {
    const ticks: number[] = [];
    await PCA_ACTION.transformSourceAsync!(
      rasterSource(makeFourBandRaster()),
      { [COMPONENT_COUNT_PARAMETER_ID]: 2 },
      (fraction) => ticks.push(fraction),
    );
    expect(ticks).toEqual([0, 0.2, 0.4, 0.5, 0.5, 0.75, 1]);
  });

  it("stays monotonic non-decreasing from 0 to 1", async () => {
    const ticks: number[] = [];
    await PCA_ACTION.transformSourceAsync!(
      rasterSource(makeFourBandRaster()),
      { [COMPONENT_COUNT_PARAMETER_ID]: 4 },
      (fraction) => ticks.push(fraction),
    );
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBe(1);
    for (let i = 1; i < ticks.length; i += 1) {
      expect(ticks[i]!).toBeGreaterThanOrEqual(ticks[i - 1]!);
    }
  });
});
