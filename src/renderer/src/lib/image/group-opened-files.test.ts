import { describe, expect, it } from "vitest";

import {
  proposeGroupsForOpenedFiles,
  type OpenedFileForGrouping,
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

function buildStackableFile(fileName: string): OpenedFileForGrouping {
  return {
    fileName,
    filePath: `/test/${fileName}`,
    fileSizeBytes: 100,
    mtimeMs: 1,
    source: buildSingleBandRasterSource(),
    decodeError: null,
    contentHash: `hash-${fileName}`,
    bytes: new Uint8Array(),
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
    bytes: new Uint8Array(),
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
    bytes: new Uint8Array(),
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
