import { describe, expect, it } from "vitest";

import {
  buildPngStackBandFileName,
  listPngStackBandFileNames,
  sanitizePngStackBaseName,
} from "@/lib/image/png-stack-file-names";

describe("sanitizePngStackBaseName", () => {
  it("strips the source extension", () => {
    expect(sanitizePngStackBaseName("multiband-12bit.tif")).toBe("multiband-12bit");
  });

  it("keeps a name without an extension as-is", () => {
    expect(sanitizePngStackBaseName("cube")).toBe("cube");
  });

  it("replaces characters invalid in file names with dashes", () => {
    expect(sanitizePngStackBaseName('a:b*c?d"e<f>g|h.tif')).toBe("a-b-c-d-e-f-g-h");
    expect(sanitizePngStackBaseName("path/like\\name.png")).toBe("path-like-name");
  });

  it("drops trailing dots and spaces (invalid on Windows)", () => {
    expect(sanitizePngStackBaseName("name...tif")).toBe("name");
  });

  it("falls back to 'stack' when nothing sanitizable remains", () => {
    expect(sanitizePngStackBaseName("   .tif")).toBe("stack");
    expect(sanitizePngStackBaseName("...")).toBe("stack");
  });
});

describe("buildPngStackBandFileName", () => {
  it("zero-pads to at least three digits for typical band counts", () => {
    expect(buildPngStackBandFileName("cube", 1, 49)).toBe("cube_band_001.png");
    expect(buildPngStackBandFileName("cube", 49, 49)).toBe("cube_band_049.png");
    expect(buildPngStackBandFileName("cube", 2, 3)).toBe("cube_band_002.png");
  });

  it("widens the padding to the band-count width past 999 bands", () => {
    expect(buildPngStackBandFileName("cube", 7, 5000)).toBe("cube_band_0007.png");
    expect(buildPngStackBandFileName("cube", 5000, 5000)).toBe("cube_band_5000.png");
  });
});

describe("listPngStackBandFileNames", () => {
  it("builds one sanitized name per band in band order", () => {
    expect(listPngStackBandFileNames("multiband-12bit.tif", 3)).toEqual([
      "multiband-12bit_band_001.png",
      "multiband-12bit_band_002.png",
      "multiband-12bit_band_003.png",
    ]);
  });
});
