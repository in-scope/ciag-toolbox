import { describe, expect, it } from "vitest";

import {
  SAVE_IMAGE_FORMAT_OPTIONS,
  describeSaveImageFormatBandCoverageNote,
  describeSaveImageFormatDisabledReason,
  findSaveImageFormatOptionOrThrow,
  readSaveImageFormatTechnicalDetails,
} from "@/lib/image/save-image-formats";

const MULTI_BAND_STACK = { isTrueColorPhoto: false, bandCount: 3, selectedBandNumber: 1 };
const SINGLE_BAND_FORMAT_IDS = [
  "tiff-16-bit",
  "tiff-8-bit",
  "tiff-float-32",
  "png-8-bit",
  "jpeg-8-bit",
] as const;

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
  // CT-173: photos are rasters now, so the gate is the true-colour flag, NOT source.kind.
  const TRUE_COLOR_PHOTO = true;
  const SCIENTIFIC_OR_SINGLE_BAND_RASTER = false;

  it("disables ENVI and ENVI float for a true-colour photo with a raster/scientific reason", () => {
    expect(describeSaveImageFormatDisabledReason("envi", TRUE_COLOR_PHOTO)).toMatch(/ENVI is for raster/);
    expect(describeSaveImageFormatDisabledReason("envi-float", TRUE_COLOR_PHOTO)).toMatch(/ENVI is for raster/);
  });

  it("disables 32-bit float TIFF for a true-colour photo because an 8-bit photo has no float data", () => {
    expect(describeSaveImageFormatDisabledReason("tiff-float-32", TRUE_COLOR_PHOTO)).toMatch(/Float export needs raster/);
  });

  it("keeps TIFF 16/8-bit, PNG and JPEG enabled for a true-colour photo", () => {
    expect(describeSaveImageFormatDisabledReason("tiff-16-bit", TRUE_COLOR_PHOTO)).toBeNull();
    expect(describeSaveImageFormatDisabledReason("tiff-8-bit", TRUE_COLOR_PHOTO)).toBeNull();
    expect(describeSaveImageFormatDisabledReason("png-8-bit", TRUE_COLOR_PHOTO)).toBeNull();
    expect(describeSaveImageFormatDisabledReason("jpeg-8-bit", TRUE_COLOR_PHOTO)).toBeNull();
  });

  it("enables every format for a scientific stack (it is not a photo)", () => {
    for (const option of SAVE_IMAGE_FORMAT_OPTIONS) {
      expect(describeSaveImageFormatDisabledReason(option.id, SCIENTIFIC_OR_SINGLE_BAND_RASTER)).toBeNull();
    }
  });

  it("enables every format for a single-band raster, including a promoted grayscale photo", () => {
    for (const option of SAVE_IMAGE_FORMAT_OPTIONS) {
      expect(describeSaveImageFormatDisabledReason(option.id, SCIENTIFIC_OR_SINGLE_BAND_RASTER)).toBeNull();
    }
  });
});

describe("describeSaveImageFormatBandCoverageNote", () => {
  it("warns that single-band formats save only the current band of a multi-band stack", () => {
    for (const formatId of SINGLE_BAND_FORMAT_IDS) {
      expect(describeSaveImageFormatBandCoverageNote(formatId, MULTI_BAND_STACK)).toBe(
        "Saves the current band only (band 1 of 3). Use ENVI to save all bands.",
      );
    }
  });

  it("names the displayed band number in the warning", () => {
    const note = describeSaveImageFormatBandCoverageNote("tiff-16-bit", {
      ...MULTI_BAND_STACK,
      selectedBandNumber: 2,
    });
    expect(note).toBe("Saves the current band only (band 2 of 3). Use ENVI to save all bands.");
  });

  it("tells ENVI saves all bands of a multi-band stack", () => {
    expect(describeSaveImageFormatBandCoverageNote("envi", MULTI_BAND_STACK)).toBe("Saves all 3 bands.");
    expect(describeSaveImageFormatBandCoverageNote("envi-float", MULTI_BAND_STACK)).toBe("Saves all 3 bands.");
  });

  it("discloses nothing for a single-band stack (no bands are lost)", () => {
    const singleBandStack = { isTrueColorPhoto: false, bandCount: 1, selectedBandNumber: 1 };
    for (const option of SAVE_IMAGE_FORMAT_OPTIONS) {
      expect(describeSaveImageFormatBandCoverageNote(option.id, singleBandStack)).toBeNull();
    }
  });

  // CT-173: a true-colour photo is a 3-band raster, but it is shown as one colour image, not a
  // browsable band stack, so it must not warn about "saving band 1 of 3" like a scientific stack.
  it("discloses nothing for a true-colour photo even though it has three bands", () => {
    const trueColorPhoto = { isTrueColorPhoto: true, bandCount: 3, selectedBandNumber: 1 };
    for (const option of SAVE_IMAGE_FORMAT_OPTIONS) {
      expect(describeSaveImageFormatBandCoverageNote(option.id, trueColorPhoto)).toBeNull();
    }
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
