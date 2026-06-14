import { describe, expect, it } from "vitest";

import {
  buildLoadedPanelReferenceToken,
  buildLoadedReferenceCandidates,
  isLoadedPanelReferenceToken,
  readReferenceTokenDisplayName,
  type LoadedPanelReferenceEntry,
} from "@/lib/image/reference-token";
import type { RasterImage } from "@/lib/image/raster-image";

describe("reference-token", () => {
  it("builds a loaded-panel token that is recognizable and carries a readable label", () => {
    const token = buildLoadedPanelReferenceToken(3, "capture.tif");
    expect(isLoadedPanelReferenceToken(token)).toBe(true);
    expect(readReferenceTokenDisplayName(token)).toBe("Panel 3 (capture.tif)");
  });

  it("does not mistake a Windows file path for a loaded-panel token", () => {
    const token = "C:\\data\\flat.tif";
    expect(isLoadedPanelReferenceToken(token)).toBe(false);
    expect(readReferenceTokenDisplayName(token)).toBe("flat.tif");
  });

  it("reads the base file name from a POSIX path token", () => {
    expect(readReferenceTokenDisplayName("/home/user/light.tif")).toBe("light.tif");
  });

  it("builds candidates with unique tokens and labels per loaded panel", () => {
    const entries: LoadedPanelReferenceEntry[] = [
      { viewportNumber: 1, fileName: "a.tif", raster: makeRaster() },
      { viewportNumber: 2, fileName: "a.tif", raster: makeRaster() },
    ];
    const candidates = buildLoadedReferenceCandidates(entries);
    expect(candidates.map((candidate) => candidate.token)).toEqual([
      buildLoadedPanelReferenceToken(1, "a.tif"),
      buildLoadedPanelReferenceToken(2, "a.tif"),
    ]);
    expect(candidates[0]!.label).toBe("Panel 1 (a.tif)");
    expect(candidates[1]!.raster).toBe(entries[1]!.raster);
  });
});

function makeRaster(): RasterImage {
  return {
    bandPixels: [new Uint8Array([1, 2])],
    width: 2,
    height: 1,
    bitsPerSample: 8,
    sampleFormat: "uint",
    bandCount: 1,
  };
}
