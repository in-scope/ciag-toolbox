import { describe, expect, it } from "vitest";

import {
  SAVE_IMAGE_FORMAT_OPTIONS,
  findSaveImageFormatOptionOrThrow,
  readSaveImageFormatTechnicalDetails,
} from "@/lib/image/save-image-formats";

describe("readSaveImageFormatTechnicalDetails", () => {
  it("maps tiff-16-bit to a 16-bit TIFF descriptor", () => {
    expect(readSaveImageFormatTechnicalDetails("tiff-16-bit")).toEqual({
      kind: "tiff",
      targetBitDepth: 16,
    });
  });

  it("maps tiff-8-bit to an 8-bit TIFF descriptor", () => {
    expect(readSaveImageFormatTechnicalDetails("tiff-8-bit")).toEqual({
      kind: "tiff",
      targetBitDepth: 8,
    });
  });

  it("maps png-8-bit to an 8-bit PNG descriptor", () => {
    expect(readSaveImageFormatTechnicalDetails("png-8-bit")).toEqual({
      kind: "png",
      targetBitDepth: 8,
    });
  });

  it("maps jpeg-8-bit to an 8-bit JPEG descriptor", () => {
    expect(readSaveImageFormatTechnicalDetails("jpeg-8-bit")).toEqual({
      kind: "jpeg",
      targetBitDepth: 8,
    });
  });

  it("maps envi to a 16-bit ENVI descriptor (bit depth follows source)", () => {
    expect(readSaveImageFormatTechnicalDetails("envi")).toEqual({
      kind: "envi",
      targetBitDepth: 16,
    });
  });
});

describe("findSaveImageFormatOptionOrThrow", () => {
  it("returns the option matching the chosen id", () => {
    const option = findSaveImageFormatOptionOrThrow("png-8-bit");
    expect(option.extension).toBe("png");
    expect(option.fileFilter.extensions).toContain("png");
  });
});

describe("SAVE_IMAGE_FORMAT_OPTIONS", () => {
  it("offers TIFF (8/16-bit), PNG, JPEG, and ENVI as the five save formats", () => {
    const ids = SAVE_IMAGE_FORMAT_OPTIONS.map((option) => option.id);
    expect(ids).toEqual(["tiff-16-bit", "tiff-8-bit", "png-8-bit", "jpeg-8-bit", "envi"]);
  });

  it("uses .hdr as the primary extension for the ENVI option", () => {
    const enviOption = SAVE_IMAGE_FORMAT_OPTIONS.find((option) => option.id === "envi");
    expect(enviOption?.extension).toBe("hdr");
    expect(enviOption?.fileFilter.extensions).toContain("hdr");
  });
});
