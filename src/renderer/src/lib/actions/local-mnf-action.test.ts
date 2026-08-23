import { describe, expect, it, vi } from "vitest";

import type { RasterImage } from "@/lib/image/raster-image";

import { LOCAL_MNF_ACTION, LOCAL_MNF_ACTION_ID } from "./local-mnf-action";
import { buildLocalProjectionSourceTransform } from "./local-projection-action";
import type { ParameterValuesById } from "./parameter-schema";
import {
  LOCAL_PROJECTION_MEAN_CENTER_PARAMETER_ID,
  LOCAL_PROJECTION_RADIUS_PARAMETER_ID,
  LOCAL_PROJECTION_STEP_PARAMETER_ID,
} from "./local-projection-params";

// CT-312: the Local MNF wiring around the packaged client script. Mirrors
// local-pca-action.test.ts exactly - local_mnf.py shares localPCA's run()
// signature, so the shared local-projection-action wiring is identical and
// only the script name / labels differ. The Python itself is proven by the
// pinned parity reference in the e2e spec.

const SOURCE_CONFIG = {
  id: LOCAL_MNF_ACTION_ID,
  label: "Local MNF",
  icon: LOCAL_MNF_ACTION.icon,
  scriptName: "local_mnf",
  componentLabelPrefix: "Local MNF",
  successMessage: "Local MNF applied",
  loadingMessage: "Computing local noise fraction components...",
} as const;

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

function completedOneBandRun(values: number[]): ToolboxRunUserScriptResult {
  return { status: "completed-cube", shape: [1, 2, 2], bands: [Float32Array.from(values)] };
}

async function runTransformWith(
  result: ToolboxRunUserScriptResult,
  parameterValues: ParameterValuesById = {},
): Promise<{ raster: RasterImage; runner: ReturnType<typeof vi.fn> }> {
  const runner = vi.fn().mockResolvedValue(result);
  const transform = buildLocalProjectionSourceTransform(SOURCE_CONFIG, runner);
  const output = await transform(
    { kind: "raster", raster: makeTwoByTwoThreeBandSource() },
    parameterValues,
  );
  return { raster: (output as { raster: RasterImage }).raster, runner };
}

describe("LOCAL_MNF_ACTION", () => {
  it("is a stoppable Multi-band operation with the three shared tunables", () => {
    expect(LOCAL_MNF_ACTION.supportsStopDuringApply).toBe(true);
    expect(LOCAL_MNF_ACTION.parameters?.map((parameter) => parameter.id)).toEqual([
      LOCAL_PROJECTION_STEP_PARAMETER_ID,
      LOCAL_PROJECTION_RADIUS_PARAMETER_ID,
      LOCAL_PROJECTION_MEAN_CENTER_PARAMETER_ID,
    ]);
  });

  it("records the parameter values in the audit trail", () => {
    expect(LOCAL_MNF_ACTION.formatAppliedLabel?.({})).toBe(
      "Local MNF (stride 8, kernel radius 8, local mean subtracted)",
    );
  });
});

describe("the Local MNF source transform", () => {
  it("runs the packaged local_mnf script with the panel's params", async () => {
    const { runner } = await runTransformWith(completedOneBandRun([1, 2, 3, 4]), {
      [LOCAL_PROJECTION_STEP_PARAMETER_ID]: 4,
      [LOCAL_PROJECTION_RADIUS_PARAMETER_ID]: 2,
      [LOCAL_PROJECTION_MEAN_CENTER_PARAMETER_ID]: false,
    });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0]?.[0]).toBe("local_mnf");
    expect(runner.mock.calls[0]?.[2]).toEqual({ step: 4, radius: 2, meanCenter: false });
  });

  it("labels the single output band as the first local MNF component", async () => {
    const { raster } = await runTransformWith(completedOneBandRun([10, 20, 30, 40]));
    expect(raster.bandCount).toBe(1);
    expect(raster.bandLabels).toEqual(["Local MNF 1"]);
    expect(raster.sampleFormat).toBe("float");
    expect(raster.bitsPerSample).toBe(32);
    expect(Array.from(raster.bandPixels[0]!)).toEqual([10, 20, 30, 40]);
  });

  it("keeps the source's spatial grid", async () => {
    const { raster } = await runTransformWith(completedOneBandRun([0, 0, 0, 0]));
    expect([raster.width, raster.height]).toEqual([2, 2]);
  });

  it("surfaces a failed run's message", async () => {
    await expect(
      runTransformWith({ status: "failed", message: "spectral is missing" }),
    ).rejects.toThrow("spectral is missing");
  });

  it("refuses a result that is not one band on the source grid", async () => {
    await expect(
      runTransformWith({
        status: "completed-cube",
        shape: [2, 2, 2],
        bands: [Float32Array.from([1, 2, 3, 4]), Float32Array.from([5, 6, 7, 8])],
      }),
    ).rejects.toThrow("instead of one band of 2 x 2");
  });
});
