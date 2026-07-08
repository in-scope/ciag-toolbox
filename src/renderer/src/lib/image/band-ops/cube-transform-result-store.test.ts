import { afterEach, describe, expect, it } from "vitest";

import {
  forgetAllCubeTransformResults,
  readRememberedCubeTransformResultOrNull,
  rememberCubeTransformResult,
} from "./cube-transform-result-store";

afterEach(() => forgetAllCubeTransformResults());

const RESULT = {
  shape: [2, 1, 2],
  bands: [Float32Array.from([1, 2]), Float32Array.from([3, 4])],
};

describe("cube-transform result store", () => {
  it("remembers a result under a unique token and reads it back", () => {
    const first = rememberCubeTransformResult(RESULT);
    const second = rememberCubeTransformResult(RESULT);
    expect(first).not.toBe(second);
    expect(readRememberedCubeTransformResultOrNull(first)).toBe(RESULT);
    expect(readRememberedCubeTransformResultOrNull(second)).toBe(RESULT);
  });

  it("returns null for an unknown token", () => {
    expect(readRememberedCubeTransformResultOrNull("cube-transform-999")).toBeNull();
  });

  it("forgets every remembered result when cleared", () => {
    const token = rememberCubeTransformResult(RESULT);
    forgetAllCubeTransformResults();
    expect(readRememberedCubeTransformResultOrNull(token)).toBeNull();
  });
});
