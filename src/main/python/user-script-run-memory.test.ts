import { describe, expect, it } from "vitest";

import { OPERATION_MEMORY_REFUSAL_MESSAGE } from "../../shared/memory-refusal-copy";
import {
  CUBE_RUN_WORKER_MEMORY_CUBE_MULTIPLIER,
  describeUserScriptRunMemoryRefusalOrNull,
  estimateUserScriptRunWorkerMemoryBytes,
  float32CubeByteLengthOf,
  VALUE_RUN_WORKER_MEMORY_CUBE_MULTIPLIER,
} from "./user-script-run-memory";

const SCALE10_FULL_CUBE = { bandCount: 100, height: 5_000, width: 10_000, wavelengths: null };
const SCALE10_SUBSET_CUBE = { bandCount: 25, height: 5_000, width: 10_000, wavelengths: null };
const THIRTY_TWO_GB = 32 * 1024 ** 3;

describe("estimateUserScriptRunWorkerMemoryBytes", () => {
  it("prices a value run at twice the float32 cube (stdin bytes plus the numpy copy)", () => {
    expect(estimateUserScriptRunWorkerMemoryBytes(SCALE10_SUBSET_CUBE, "value")).toBe(
      float32CubeByteLengthOf(SCALE10_SUBSET_CUBE) * VALUE_RUN_WORKER_MEMORY_CUBE_MULTIPLIER,
    );
  });

  it("prices a cube run at three cubes (input bytes, numpy copy, output cube)", () => {
    expect(estimateUserScriptRunWorkerMemoryBytes(SCALE10_SUBSET_CUBE, "cube")).toBe(
      float32CubeByteLengthOf(SCALE10_SUBSET_CUBE) * CUBE_RUN_WORKER_MEMORY_CUBE_MULTIPLIER,
    );
  });
});

describe("describeUserScriptRunMemoryRefusalOrNull", () => {
  it("refuses a full-scale value run on a 32 GB machine with the CT-239 copy", () => {
    expect(describeUserScriptRunMemoryRefusalOrNull(SCALE10_FULL_CUBE, "value", THIRTY_TWO_GB)).toBe(
      OPERATION_MEMORY_REFUSAL_MESSAGE,
    );
  });

  it("allows the 25-band subset for both result kinds on a 32 GB machine", () => {
    expect(describeUserScriptRunMemoryRefusalOrNull(SCALE10_SUBSET_CUBE, "value", THIRTY_TWO_GB)).toBeNull();
    expect(describeUserScriptRunMemoryRefusalOrNull(SCALE10_SUBSET_CUBE, "cube", THIRTY_TWO_GB)).toBeNull();
  });

  it("allows the full-scale value run when the machine has the memory for it", () => {
    const sixtyFourGb = 2 * THIRTY_TWO_GB;
    expect(describeUserScriptRunMemoryRefusalOrNull(SCALE10_FULL_CUBE, "value", sixtyFourGb)).toBeNull();
  });
});
