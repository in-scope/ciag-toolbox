import { afterEach, describe, expect, it } from "vitest";

import {
  forgetAllBandSelectionResults,
  readRememberedBandSelectionResultOrNull,
  rememberBandSelectionResult,
} from "./band-selection-result-store";

afterEach(() => forgetAllBandSelectionResults());

describe("band selection result store", () => {
  it("remembers a band under a fresh token and reads it back", () => {
    const result = { values: Float32Array.from([1, 2, 3, 4]), width: 2, height: 2 };
    const token = rememberBandSelectionResult(result);
    expect(readRememberedBandSelectionResultOrNull(token)).toBe(result);
  });

  it("hands out a distinct token for each remembered result", () => {
    const first = rememberBandSelectionResult({ values: new Float32Array(1), width: 1, height: 1 });
    const second = rememberBandSelectionResult({ values: new Float32Array(1), width: 1, height: 1 });
    expect(first).not.toBe(second);
  });

  it("returns null for an unknown token", () => {
    expect(readRememberedBandSelectionResultOrNull("band-selection-does-not-exist")).toBeNull();
  });
});
