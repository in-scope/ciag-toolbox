import { describe, expect, it } from "vitest";

import { formatToneCurveEditingBandLabel } from "@/lib/image/tone-curve-editing-band-label";
import type { RasterImage } from "@/lib/image/raster-image";

function buildScientificStack(overrides: Partial<RasterImage>): RasterImage {
  return {
    width: 1,
    height: 1,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 3,
    bandPixels: [new Uint16Array([1]), new Uint16Array([2]), new Uint16Array([3])],
    ...overrides,
  };
}

describe("formatToneCurveEditingBandLabel", () => {
  it("names the 1-based band number when the stack has no labels or wavelengths", () => {
    const raster = buildScientificStack({});
    expect(formatToneCurveEditingBandLabel(raster, 0)).toBe("Editing band 1");
    expect(formatToneCurveEditingBandLabel(raster, 2)).toBe("Editing band 3");
  });

  it("appends an explicit band label when present", () => {
    const raster = buildScientificStack({ bandLabels: ["", "Near IR", ""] });
    expect(formatToneCurveEditingBandLabel(raster, 1)).toBe("Editing band 2 (Near IR)");
  });

  it("appends the wavelength when the band has no explicit label", () => {
    const raster = buildScientificStack({ bandWavelengths: [450, 550, 650] });
    expect(formatToneCurveEditingBandLabel(raster, 2)).toBe("Editing band 3 (650 nm)");
  });

  it("tracks the original band number when the stack was subset", () => {
    const raster = buildScientificStack({ bandOriginalNumbers: [1, 3, 5] });
    expect(formatToneCurveEditingBandLabel(raster, 1)).toBe("Editing band 3");
  });
});
