import { describe, expect, it } from "vitest";

import {
  SAVE_IMAGE_FORMAT_OPTIONS,
  describeSaveImageFormatDisabledReason,
  findSaveImageFormatOptionOrThrow,
  readSaveImageFormatTechnicalDetails,
} from "@/lib/image/save-image-formats";

describe("readSaveImageFormatTechnicalDetails", () => {
  it("maps tiff-16-bit to a 16-bit uint TIFF descriptor", () => {
    expect(readSaveImageFormatTechnicalDetails("tiff-16-bit")).toEqual({
      kind: "tiff",
      targetBitDepth: 16,
      targetSampleFormat: "uint",
    });
  });

  it("maps tiff-8-bit to an 8-bit uint TIFF descriptor", () => {
    expect(readSaveImageFormatTechnicalDetails("tiff-8-bit")).toEqual({
      kind: "tiff",
      targetBitDepth: 8,
      targetSampleFormat: "uint",
    });
  });

  it("maps tiff-float-32 to a float TIFF descriptor", () => {
    expect(readSaveImageFormatTechnicalDetails("tiff-float-32")).toEqual({
      kind: "tiff",
      targetBitDepth: 16,
      targetSampleFormat: "float",
    });
  });

  it("maps png-8-bit to an 8-bit PNG descriptor", () => {
    expect(readSaveImageFormatTechnicalDetails("png-8-bit")).toEqual({
      kind: "png",
      targetBitDepth: 8,
      targetSampleFormat: "uint",
    });
  });

  it("maps jpeg-8-bit to an 8-bit JPEG descriptor", () => {
    expect(readSaveImageFormatTechnicalDetails("jpeg-8-bit")).toEqual({
      kind: "jpeg",
      targetBitDepth: 8,
      targetSampleFormat: "uint",
    });
  });

  it("maps envi to a uint ENVI descriptor (bit depth follows source)", () => {
    expect(readSaveImageFormatTechnicalDetails("envi")).toEqual({
      kind: "envi",
      targetBitDepth: 16,
      targetSampleFormat: "uint",
    });
  });

  it("maps envi-float to a float ENVI descriptor", () => {
    expect(readSaveImageFormatTechnicalDetails("envi-float")).toEqual({
      kind: "envi",
      targetBitDepth: 16,
      targetSampleFormat: "float",
    });
  });
});

describe("describeSaveImageFormatDisabledReason", () => {
  it("enables every format for a raster source (no reason)", () => {
    for (const option of SAVE_IMAGE_FORMAT_OPTIONS) {
      expect(describeSaveImageFormatDisabledReason(option.id, true)).toBeNull();
    }
  });

  it("disables ENVI and ENVI float for a photo source with a raster/scientific reason", () => {
    expect(describeSaveImageFormatDisabledReason("envi", false)).toMatch(/ENVI is for raster/);
    expect(describeSaveImageFormatDisabledReason("envi-float", false)).toMatch(/ENVI is for raster/);
  });

  it("disables 32-bit float TIFF for a photo source because an 8-bit photo has no float data", () => {
    expect(describeSaveImageFormatDisabledReason("tiff-float-32", false)).toMatch(/Float export needs raster/);
  });

  it("keeps TIFF 16/8-bit, PNG and JPEG enabled for a photo source", () => {
    expect(describeSaveImageFormatDisabledReason("tiff-16-bit", false)).toBeNull();
    expect(describeSaveImageFormatDisabledReason("tiff-8-bit", false)).toBeNull();
    expect(describeSaveImageFormatDisabledReason("png-8-bit", false)).toBeNull();
    expect(describeSaveImageFormatDisabledReason("jpeg-8-bit", false)).toBeNull();
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
  it("offers TIFF (16/8-bit/float), PNG, JPEG, and ENVI (uint/float) save formats", () => {
    const ids = SAVE_IMAGE_FORMAT_OPTIONS.map((option) => option.id);
    expect(ids).toEqual([
      "tiff-16-bit",
      "tiff-8-bit",
      "tiff-float-32",
      "png-8-bit",
      "jpeg-8-bit",
      "envi",
      "envi-float",
    ]);
  });

  it("uses .hdr as the primary extension for the ENVI option", () => {
    const enviOption = SAVE_IMAGE_FORMAT_OPTIONS.find((option) => option.id === "envi");
    expect(enviOption?.extension).toBe("hdr");
    expect(enviOption?.fileFilter.extensions).toContain("hdr");
  });
});
