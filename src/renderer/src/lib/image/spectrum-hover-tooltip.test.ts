import { describe, expect, it } from "vitest";
import type { RasterImage } from "@/lib/image/raster-image";
import {
  buildSpectrumBandTooltipDescriptors,
  formatSpectrumHoverBandLabel,
  formatSpectrumHoverValueLabel,
} from "@/lib/image/spectrum-hover-tooltip";

function makeRaster(overrides: Partial<RasterImage>): RasterImage {
  return {
    bandPixels: [new Uint16Array([1]), new Uint16Array([2]), new Uint16Array([3])],
    width: 1,
    height: 1,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 3,
    ...overrides,
  };
}

describe("buildSpectrumBandTooltipDescriptors", () => {
  it("uses original band numbers and no wavelength when none are present", () => {
    const descriptors = buildSpectrumBandTooltipDescriptors(makeRaster({ bandOriginalNumbers: [3, 5, 8] }));
    expect(descriptors).toEqual([
      { bandNumber: 3, wavelengthNm: null },
      { bandNumber: 5, wavelengthNm: null },
      { bandNumber: 8, wavelengthNm: null },
    ]);
  });

  it("pairs each band with its wavelength when wavelengths match the band count", () => {
    const descriptors = buildSpectrumBandTooltipDescriptors(makeRaster({ bandWavelengths: [450, 540, 660] }));
    expect(descriptors.map((d) => d.wavelengthNm)).toEqual([450, 540, 660]);
  });

  it("ignores wavelengths whose length does not match the band count", () => {
    const descriptors = buildSpectrumBandTooltipDescriptors(makeRaster({ bandWavelengths: [450, 540] }));
    expect(descriptors.every((d) => d.wavelengthNm === null)).toBe(true);
  });
});

describe("formatSpectrumHoverBandLabel", () => {
  it("formats a band without a wavelength", () => {
    expect(formatSpectrumHoverBandLabel({ bandNumber: 3, wavelengthNm: null })).toBe("Band 3");
  });

  it("appends a rounded wavelength when present", () => {
    expect(formatSpectrumHoverBandLabel({ bandNumber: 3, wavelengthNm: 540.4 })).toBe("Band 3 (540 nm)");
  });
});

describe("formatSpectrumHoverValueLabel", () => {
  it("formats an integer value plainly", () => {
    expect(formatSpectrumHoverValueLabel({ lineId: "a", value: 39823, standardDeviation: null }, "uint")).toBe("39823");
  });

  it("appends the standard deviation for an ROI mean", () => {
    const label = formatSpectrumHoverValueLabel({ lineId: "a", value: 100, standardDeviation: 5 }, "uint");
    expect(label).toBe("100 ± 5");
  });

  it("formats float values to significant figures", () => {
    const label = formatSpectrumHoverValueLabel({ lineId: "a", value: 0.523456, standardDeviation: null }, "float");
    expect(label).toBe("0.5235");
  });
});
