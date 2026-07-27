import { describe, expect, it } from "vitest";

import type { RasterImage } from "@/lib/image/raster-image";

import {
  describeCubeScopeForAppliedLabel,
  injectSourceBandCountForBandWiseLabels,
  resolveCubeScopeSelectionFromParameters,
  resolveScopedBandIndexSet,
  type CubeScopeParameterIds,
} from "./band-scope-selection";

const IDS: CubeScopeParameterIds = {
  scopeParameterId: "scope",
  bandRangeParameterId: "bandRange",
  bandCountParameterId: "sourceBandCount",
};

function makeFiveBandRaster(): RasterImage {
  return {
    bandPixels: Array.from({ length: 5 }, () => new Uint8Array(4)),
    width: 2,
    height: 2,
    bandCount: 5,
    sampleFormat: "uint",
    bitsPerSample: 8,
  };
}

describe("resolveScopedBandIndexSet", () => {
  it("selects every band under the full-stack scope", () => {
    expect(resolveScopedBandIndexSet(IDS, { scope: "full-cube" }, 3)).toEqual(new Set([0, 1, 2]));
  });

  it("selects the entered bands under band-wise scope", () => {
    const selected = resolveScopedBandIndexSet(IDS, { scope: "band-wise", bandRange: "1,3" }, 3);
    expect(selected).toEqual(new Set([0, 2]));
  });

  it("selects every band when the band-wise field is empty (CT-251)", () => {
    const selected = resolveScopedBandIndexSet(IDS, { scope: "band-wise", bandRange: "  " }, 4);
    expect(selected).toEqual(new Set([0, 1, 2, 3]));
  });
});

describe("resolveCubeScopeSelectionFromParameters", () => {
  it("maps the full-stack scope to a full-cube selection", () => {
    expect(resolveCubeScopeSelectionFromParameters(IDS, { scope: "full-cube" }, 3)).toEqual({
      scope: "full-cube",
    });
  });

  it("resolves an empty band-wise field to the full band index set (CT-251)", () => {
    expect(resolveCubeScopeSelectionFromParameters(IDS, { scope: "band-wise" }, 3)).toEqual({
      scope: "band-wise",
      bandIndexes: [0, 1, 2],
    });
  });

  it("throws the parse error for an out-of-range band-wise entry", () => {
    expect(() =>
      resolveCubeScopeSelectionFromParameters(IDS, { scope: "band-wise", bandRange: "9" }, 3),
    ).toThrow(/out of range/i);
  });
});

describe("injectSourceBandCountForBandWiseLabels", () => {
  it("captures the source band count under the configured parameter id", () => {
    const prepared = injectSourceBandCountForBandWiseLabels(IDS, { scope: "band-wise" }, makeFiveBandRaster());
    expect(prepared).toEqual({ scope: "band-wise", sourceBandCount: 5 });
  });

  it("leaves the parameters untouched when no source raster is available", () => {
    const raw = { scope: "band-wise" };
    expect(injectSourceBandCountForBandWiseLabels(IDS, raw, null)).toBe(raw);
  });
});

describe("describeCubeScopeForAppliedLabel", () => {
  it("describes the full-stack scope", () => {
    expect(describeCubeScopeForAppliedLabel(IDS, { scope: "full-cube" })).toBe("full stack");
  });

  it("describes an entered band set", () => {
    expect(describeCubeScopeForAppliedLabel(IDS, { scope: "band-wise", bandRange: "1-3,5" })).toBe(
      "band-wise: bands 1-3,5",
    );
  });

  it("describes an empty field as the full band range via the captured count (CT-251)", () => {
    const values = { scope: "band-wise", bandRange: "", sourceBandCount: 5 };
    expect(describeCubeScopeForAppliedLabel(IDS, values)).toBe("band-wise: bands 1-5");
  });

  it("describes an empty field as all bands when no count was captured", () => {
    expect(describeCubeScopeForAppliedLabel(IDS, { scope: "band-wise" })).toBe(
      "band-wise: all bands",
    );
  });
});
