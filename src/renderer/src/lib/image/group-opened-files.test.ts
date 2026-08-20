import { describe, expect, it } from "vitest";

import {
  proposeGroupsForOpenedFiles,
  splitGroupRowsIntoSingleImageGroups,
  type OpenedFileForGrouping,
  type OpenedFilesGroup,
} from "./group-opened-files";
import type { RasterImage } from "./raster-image";
import type { ViewportImageSource } from "../webgl/texture";

function buildSingleBandRasterFixture(): RasterImage {
  return {
    bandPixels: [new Uint16Array(4)],
    width: 2,
    height: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 1,
  };
}

function buildMultiBandRasterFixture(bandCount: number): RasterImage {
  const bandPixels = Array.from({ length: bandCount }, () => new Uint16Array(4));
  return {
    bandPixels,
    width: 2,
    height: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount,
  };
}

function buildSingleBandRasterSource(): ViewportImageSource {
  return { kind: "raster", raster: buildSingleBandRasterFixture() };
}

function buildMultiBandRasterSource(bandCount: number): ViewportImageSource {
  return { kind: "raster", raster: buildMultiBandRasterFixture(bandCount) };
}

// CT-263: what a browser-decoded photo looks like after promotion - a
// grayscale photo is a plain single-band uint8 raster, a colour photo a
// 3-band raster tagged rgb.
function buildPromotedGrayscalePhotoSource(): ViewportImageSource {
  return {
    kind: "raster",
    raster: {
      bandPixels: [new Uint8Array(4)],
      width: 2,
      height: 2,
      bitsPerSample: 8,
      sampleFormat: "uint",
      bandCount: 1,
    },
  };
}

function buildPromotedColorPhotoSource(): ViewportImageSource {
  return {
    kind: "raster",
    raster: {
      bandPixels: [new Uint8Array(4), new Uint8Array(4), new Uint8Array(4)],
      width: 2,
      height: 2,
      bitsPerSample: 8,
      sampleFormat: "uint",
      bandCount: 3,
      bandLabels: ["Red", "Green", "Blue"],
      colorInterpretation: "rgb",
    },
  };
}

function buildFileWithSource(
  fileName: string,
  source: ViewportImageSource,
): OpenedFileForGrouping {
  return {
    fileName,
    filePath: `/test/${fileName}`,
    fileSizeBytes: 100,
    mtimeMs: 1,
    source,
    decodeError: null,
    contentHash: `hash-${fileName}`,
  };
}

function buildStackableFile(fileName: string): OpenedFileForGrouping {
  return {
    fileName,
    filePath: `/test/${fileName}`,
    fileSizeBytes: 100,
    mtimeMs: 1,
    source: buildSingleBandRasterSource(),
    decodeError: null,
    contentHash: `hash-${fileName}`,
  };
}

function buildMultiBandFile(fileName: string, bandCount: number): OpenedFileForGrouping {
  return {
    fileName,
    filePath: `/test/${fileName}`,
    fileSizeBytes: 100,
    mtimeMs: 1,
    source: buildMultiBandRasterSource(bandCount),
    decodeError: null,
    contentHash: `hash-${fileName}`,
  };
}

function buildDecodeFailedFile(fileName: string, message: string): OpenedFileForGrouping {
  return {
    fileName,
    filePath: `/test/${fileName}`,
    fileSizeBytes: 100,
    mtimeMs: 1,
    source: null,
    decodeError: message,
    contentHash: `hash-${fileName}`,
  };
}

describe("proposeGroupsForOpenedFiles", () => {
  it("produces a single empty proposal when given no files", () => {
    const result = proposeGroupsForOpenedFiles([]);
    expect(result.groups).toEqual([]);
  });

  it("produces a single stack group from a set of single-band stackable files with a common prefix", () => {
    const files = [
      buildStackableFile("img_w450_capture.tif"),
      buildStackableFile("img_w501_capture.tif"),
      buildStackableFile("img_w552_capture.tif"),
    ];
    const result = proposeGroupsForOpenedFiles(files);
    expect(result.groups).toHaveLength(1);
    const stackGroup = result.groups[0]!;
    expect(stackGroup.mode).toBe("stack");
    expect(stackGroup.rows.map((row) => row.fileName)).toEqual([
      "img_w450_capture.tif",
      "img_w501_capture.tif",
      "img_w552_capture.tif",
    ]);
    expect(stackGroup.hadConfidentWavelengthParse).toBe(true);
  });

  it("returns multi-band rasters as their own single-image proposals", () => {
    const files = [buildMultiBandFile("rgb.png", 3)];
    const result = proposeGroupsForOpenedFiles(files);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.mode).toBe("singles");
    expect(result.groups[0]!.rows.map((row) => row.fileName)).toEqual(["rgb.png"]);
  });

  it("clusters promoted grayscale photos (single-band uint8 rasters) into one stack group (CT-263)", () => {
    const files = [
      buildFileWithSource("scan_a.png", buildPromotedGrayscalePhotoSource()),
      buildFileWithSource("scan_b.png", buildPromotedGrayscalePhotoSource()),
      buildFileWithSource("scan_c.png", buildPromotedGrayscalePhotoSource()),
    ];
    const result = proposeGroupsForOpenedFiles(files);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.mode).toBe("stack");
    expect(result.groups[0]!.rows).toHaveLength(3);
  });

  it("isolates a colour photo (rgb-tagged 3-band raster) into its own single-image proposal (CT-263)", () => {
    const files = [
      buildFileWithSource("scan_a.png", buildPromotedGrayscalePhotoSource()),
      buildFileWithSource("scan_b.png", buildPromotedGrayscalePhotoSource()),
      buildFileWithSource("photo.jpg", buildPromotedColorPhotoSource()),
    ];
    const result = proposeGroupsForOpenedFiles(files);
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0]!.mode).toBe("stack");
    expect(result.groups[0]!.rows.map((row) => row.fileName)).toEqual(["scan_a.png", "scan_b.png"]);
    expect(result.groups[1]!.mode).toBe("singles");
    expect(result.groups[1]!.rows[0]!.fileName).toBe("photo.jpg");
  });

  it("returns decode-failed files as their own single-image proposals", () => {
    const files = [buildDecodeFailedFile("broken.tif", "Failed to decode TIFF")];
    const result = proposeGroupsForOpenedFiles(files);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.mode).toBe("singles");
    expect(result.groups[0]!.rows[0]!.decodeError).toBe("Failed to decode TIFF");
  });

  it("clusters mixed-extension single-band rasters into one stack group when names share structure", () => {
    const files = [
      buildStackableFile("frame_001.png"),
      buildStackableFile("frame_002.png"),
      buildStackableFile("frame_003.png"),
    ];
    const result = proposeGroupsForOpenedFiles(files);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.mode).toBe("stack");
    expect(result.groups[0]!.rows).toHaveLength(3);
  });

  it("places a single stackable file in a singles-mode group (one alone is not a stack)", () => {
    const files = [buildStackableFile("solo.tif")];
    const result = proposeGroupsForOpenedFiles(files);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.mode).toBe("singles");
  });

  it("returns a stack group plus singles for a mix of stackable and non-stackable inputs", () => {
    const files = [
      buildStackableFile("img_w450_capture.tif"),
      buildStackableFile("img_w501_capture.tif"),
      buildMultiBandFile("rgb.jpg", 3),
      buildDecodeFailedFile("broken.tif", "decode error"),
    ];
    const result = proposeGroupsForOpenedFiles(files);
    expect(result.groups).toHaveLength(3);
    expect(result.groups[0]!.mode).toBe("stack");
    expect(result.groups[0]!.rows).toHaveLength(2);
    expect(result.groups[1]!.rows[0]!.fileName).toBe("rgb.jpg");
    expect(result.groups[2]!.rows[0]!.fileName).toBe("broken.tif");
  });
});

describe("splitGroupRowsIntoSingleImageGroups", () => {
  function proposeWavelengthStackGroup(): {
    files: ReadonlyArray<OpenedFileForGrouping>;
    group: OpenedFilesGroup;
  } {
    const files = [
      buildStackableFile("img_w450_capture.tif"),
      buildStackableFile("img_w501_capture.tif"),
      buildStackableFile("img_w552_capture.tif"),
    ];
    return { files, group: proposeGroupsForOpenedFiles(files).groups[0]! };
  }

  it("splits a multi-row group into one singles group per row in the same order", () => {
    const { group } = proposeWavelengthStackGroup();
    const split = splitGroupRowsIntoSingleImageGroups(group);
    expect(split).toHaveLength(3);
    expect(split.every((singleGroup) => singleGroup.mode === "singles")).toBe(true);
    expect(split.map((singleGroup) => singleGroup.rows.map((row) => row.fileName))).toEqual([
      ["img_w450_capture.tif"],
      ["img_w501_capture.tif"],
      ["img_w552_capture.tif"],
    ]);
  });

  it("gives every split group a unique id distinct from the source group's id", () => {
    const { group } = proposeWavelengthStackGroup();
    const ids = splitGroupRowsIntoSingleImageGroups(group).map((singleGroup) => singleGroup.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).not.toContain(group.id);
  });

  it("normalizes each split row to the isolated-single shape: no wavelength, full-name emphasis", () => {
    const { group } = proposeWavelengthStackGroup();
    expect(group.rows.some((row) => row.wavelength !== null)).toBe(true);
    for (const singleGroup of splitGroupRowsIntoSingleImageGroups(group)) {
      expect(singleGroup.hadConfidentWavelengthParse).toBe(false);
      expect(singleGroup.rows).toHaveLength(1);
      expect(singleGroup.rows[0]!.wavelength).toBeNull();
      expect(singleGroup.rows[0]!.differentiatingSubstring).toBe(singleGroup.rows[0]!.fileName);
    }
  });

  it("keeps every row's decoded source and file facts by reference", () => {
    const { group } = proposeWavelengthStackGroup();
    splitGroupRowsIntoSingleImageGroups(group).forEach((singleGroup, index) => {
      const sourceRow = group.rows[index]!;
      const splitRow = singleGroup.rows[0]!;
      expect(splitRow.source).toBe(sourceRow.source);
      expect(splitRow.contentHash).toBe(sourceRow.contentHash);
      expect(splitRow.filePath).toBe(sourceRow.filePath);
      expect(splitRow.fileSizeBytes).toBe(sourceRow.fileSizeBytes);
      expect(splitRow.mtimeMs).toBe(sourceRow.mtimeMs);
    });
  });

  it("carries ENVI sidecar facts through the split", () => {
    const group: OpenedFilesGroup = {
      id: "image-1",
      mode: "stack",
      rows: [
        {
          fileName: "cube.hdr",
          filePath: "/test/cube.hdr",
          fileSizeBytes: 100,
          mtimeMs: 1,
          source: buildSingleBandRasterSource(),
          decodeError: null,
          wavelength: 450,
          differentiatingSubstring: "450",
          contentHash: "hash-cube",
          sidecarFileName: "cube.raw",
          sidecarSizeBytes: 4096,
        },
      ],
      hadConfidentWavelengthParse: false,
    };
    const split = splitGroupRowsIntoSingleImageGroups(group);
    expect(split[0]!.rows[0]!.sidecarFileName).toBe("cube.raw");
    expect(split[0]!.rows[0]!.sidecarSizeBytes).toBe(4096);
  });
});
