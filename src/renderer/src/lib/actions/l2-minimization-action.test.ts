import { afterEach, describe, expect, it, vi } from "vitest";

import { addCategoryToLayer, createMaskLayer, type MaskLayer } from "@/lib/masks/mask-layer";
import { syncRememberedMaskLayers } from "@/lib/masks/mask-layer-reference-store";
import type { RasterImage } from "@/lib/image/raster-image";

import { buildL2MinimizationSourceTransform, L2_MINIMIZATION_ACTION } from "./l2-minimization-action";
import {
  L2_LOWER_VALUE_PARAMETER_ID,
  L2_MASK_LAYER_PARAMETER_ID,
  L2_UPPER_VALUE_PARAMETER_ID,
} from "./l2-minimization-params";
import type { ParameterValuesById } from "./parameter-schema";

// CT-313: the L2 minimization wiring around the packaged client script. The
// Python itself is proven by the pinned parity reference in the e2e spec;
// what is asserted here is everything the renderer owns - resolving the
// chosen mask layer, the masks/params the run receives, the one-band float32
// component stack it builds, and the refusal to accept a result that does not
// match the source grid.

function makeTwoByTwoThreeBandSource(): RasterImage {
  return {
    bandPixels: [
      Uint16Array.from([1, 2, 3, 4]),
      Uint16Array.from([5, 6, 7, 8]),
      Uint16Array.from([9, 10, 11, 12]),
    ],
    width: 2,
    height: 2,
    bandCount: 3,
    sampleFormat: "uint",
    bitsPerSample: 16,
  };
}

function buildLayerPaintedWith(id: string, painted: ReadonlyArray<number>): MaskLayer {
  const layer = addCategoryToLayer(createMaskLayer(id, `Layer ${id}`, 2, 2));
  return { ...layer, values: Uint8Array.from(painted) };
}

function completedOneBandRun(values: number[]): ToolboxRunUserScriptResult {
  return { status: "completed-cube", shape: [1, 2, 2], bands: [Float32Array.from(values)] };
}

afterEach(() => {
  syncRememberedMaskLayers([]);
});

async function runTransformWith(
  result: ToolboxRunUserScriptResult,
  parameterValues: ParameterValuesById,
): Promise<{ raster: RasterImage; runner: ReturnType<typeof vi.fn> }> {
  const runner = vi.fn().mockResolvedValue(result);
  const transform = buildL2MinimizationSourceTransform(runner);
  const output = await transform({ kind: "raster", raster: makeTwoByTwoThreeBandSource() }, parameterValues);
  return { raster: (output as { raster: RasterImage }).raster, runner };
}

describe("L2_MINIMIZATION_ACTION", () => {
  it("is a stoppable Multi-band operation with the mask layer and target-value fields", () => {
    expect(L2_MINIMIZATION_ACTION.supportsStopDuringApply).toBe(true);
    expect(L2_MINIMIZATION_ACTION.parameters?.map((parameter) => parameter.id)).toEqual([
      L2_MASK_LAYER_PARAMETER_ID,
      L2_LOWER_VALUE_PARAMETER_ID,
      L2_UPPER_VALUE_PARAMETER_ID,
    ]);
  });
});

describe("the L2 minimization source transform", () => {
  it("refuses to run without a chosen mask layer", async () => {
    await expect(runTransformWith(completedOneBandRun([1, 2, 3, 4]), {})).rejects.toThrow(
      "Choose a mask layer",
    );
  });

  it("refuses to run when the chosen layer is no longer remembered", async () => {
    await expect(
      runTransformWith(completedOneBandRun([1, 2, 3, 4]), { [L2_MASK_LAYER_PARAMETER_ID]: "mask-1" }),
    ).rejects.toThrow("no longer available");
  });

  it("runs the packaged l2_minimization script with the layer's masks and the panel's params", async () => {
    syncRememberedMaskLayers([buildLayerPaintedWith("mask-1", [1, 2, 0, 1])]);
    const { runner } = await runTransformWith(completedOneBandRun([1, 2, 3, 4]), {
      [L2_MASK_LAYER_PARAMETER_ID]: "mask-1",
      [L2_LOWER_VALUE_PARAMETER_ID]: -1,
      [L2_UPPER_VALUE_PARAMETER_ID]: 2,
    });
    expect(runner).toHaveBeenCalledTimes(1);
    const [, settings, layer] = runner.mock.calls[0]!;
    expect(settings).toEqual({ maskLayerId: "mask-1", lowerVal: -1, upperVal: 2 });
    expect(layer.id).toBe("mask-1");
  });

  it("labels the single output band and keeps the source's spatial grid", async () => {
    syncRememberedMaskLayers([buildLayerPaintedWith("mask-1", [1, 2, 0, 1])]);
    const { raster } = await runTransformWith(completedOneBandRun([10, 20, 30, 40]), {
      [L2_MASK_LAYER_PARAMETER_ID]: "mask-1",
    });
    expect(raster.bandCount).toBe(1);
    expect(raster.bandLabels).toEqual(["L2 Minimization 1"]);
    expect(raster.sampleFormat).toBe("float");
    expect([raster.width, raster.height]).toEqual([2, 2]);
    expect(Array.from(raster.bandPixels[0]!)).toEqual([10, 20, 30, 40]);
  });

  it("surfaces a failed run's message", async () => {
    syncRememberedMaskLayers([buildLayerPaintedWith("mask-1", [1, 2, 0, 1])]);
    await expect(
      runTransformWith(
        { status: "failed", message: "need at least 4 labeled pixels" },
        { [L2_MASK_LAYER_PARAMETER_ID]: "mask-1" },
      ),
    ).rejects.toThrow("need at least 4 labeled pixels");
  });

  it("refuses a result that is not one band on the source grid", async () => {
    syncRememberedMaskLayers([buildLayerPaintedWith("mask-1", [1, 2, 0, 1])]);
    await expect(
      runTransformWith(
        { status: "completed-cube", shape: [2, 2, 2], bands: [Float32Array.from([1, 2, 3, 4]), Float32Array.from([5, 6, 7, 8])] },
        { [L2_MASK_LAYER_PARAMETER_ID]: "mask-1" },
      ),
    ).rejects.toThrow("instead of one band of 2 x 2");
  });
});
