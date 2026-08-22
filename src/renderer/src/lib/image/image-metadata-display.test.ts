import { describe, expect, it } from "vitest";

import {
  buildViewportImageMetadataDisplay,
  computeRasterDataSizeBytes,
  detectImageFormatFromFileName,
  formatByteCountForDisplay,
  formatRelativeOrAbsoluteFilePathForDisplay,
} from "@/lib/image/image-metadata-display";
import type { RasterImage } from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

describe("detectImageFormatFromFileName", () => {
  it("detects TIFF from .tif and .tiff extensions case-insensitively", () => {
    expect(detectImageFormatFromFileName("capture.tif")).toBe("TIFF");
    expect(detectImageFormatFromFileName("CAPTURE.TIFF")).toBe("TIFF");
  });

  it("detects PNG, JPEG, ENVI, and Raw camera extensions", () => {
    expect(detectImageFormatFromFileName("photo.png")).toBe("PNG");
    expect(detectImageFormatFromFileName("photo.jpg")).toBe("JPEG");
    expect(detectImageFormatFromFileName("photo.JPEG")).toBe("JPEG");
    expect(detectImageFormatFromFileName("scan.hdr")).toBe("ENVI");
    expect(detectImageFormatFromFileName("DSC_0001.NEF")).toBe("Raw");
    expect(detectImageFormatFromFileName("image.dng")).toBe("Raw");
  });

  it("falls back to 'Image' for unknown extensions", () => {
    expect(detectImageFormatFromFileName("data.bin")).toBe("Image");
    expect(detectImageFormatFromFileName("untitled")).toBe("Image");
  });
});

describe("formatByteCountForDisplay", () => {
  it("returns '-' for missing or invalid inputs", () => {
    expect(formatByteCountForDisplay(undefined)).toBe("-");
    expect(formatByteCountForDisplay(Number.NaN)).toBe("-");
    expect(formatByteCountForDisplay(-1)).toBe("-");
  });

  it("renders raw bytes when below 1 KB", () => {
    expect(formatByteCountForDisplay(0)).toBe("0 B");
    expect(formatByteCountForDisplay(512)).toBe("512 B");
    expect(formatByteCountForDisplay(1023)).toBe("1023 B");
  });

  it("renders kilobytes, megabytes, and gigabytes with one fractional digit", () => {
    expect(formatByteCountForDisplay(1024)).toBe("1.0 KB");
    expect(formatByteCountForDisplay(1536)).toBe("1.5 KB");
    expect(formatByteCountForDisplay(1024 * 1024)).toBe("1.0 MB");
    expect(formatByteCountForDisplay(2.5 * 1024 * 1024)).toBe("2.5 MB");
    expect(formatByteCountForDisplay(3 * 1024 * 1024 * 1024)).toBe("3.0 GB");
  });
});

describe("computeRasterDataSizeBytes", () => {
  it("computes width x height x bands x 1 byte for a uint8 raster", () => {
    const raster = buildSyntheticRaster({
      width: 5,
      height: 3,
      bandCount: 2,
      bitsPerSample: 8,
      sampleFormat: "uint",
      makeBand: (length) => new Uint8Array(length),
    });
    expect(computeRasterDataSizeBytes(raster)).toBe(5 * 3 * 2 * 1);
  });

  it("computes width x height x bands x 2 bytes for a uint16 raster", () => {
    const raster = buildSyntheticUint16RasterWithThreeBands();
    expect(computeRasterDataSizeBytes(raster)).toBe(4 * 4 * 3 * 2);
  });

  it("computes width x height x bands x 4 bytes for a float32 raster", () => {
    const raster = buildSyntheticRaster({
      width: 6,
      height: 2,
      bandCount: 4,
      bitsPerSample: 32,
      sampleFormat: "float",
      makeBand: (length) => new Float32Array(length),
    });
    expect(computeRasterDataSizeBytes(raster)).toBe(6 * 2 * 4 * 4);
  });
});

describe("formatRelativeOrAbsoluteFilePathForDisplay", () => {
  it("returns the absolute path with forward slashes when no project file is provided", () => {
    expect(formatRelativeOrAbsoluteFilePathForDisplay("C:\\Users\\demo\\img.tif", null)).toBe(
      "C:/Users/demo/img.tif",
    );
  });

  it("strips the project directory prefix and returns a relative path", () => {
    const projectFile = "C:\\Users\\demo\\session.ctproj";
    const sourcePath = "C:\\Users\\demo\\images\\capture.tif";
    expect(formatRelativeOrAbsoluteFilePathForDisplay(sourcePath, projectFile)).toBe(
      "images/capture.tif",
    );
  });

  it("falls back to absolute path when source is outside the project directory tree", () => {
    const projectFile = "/Users/demo/session.ctproj";
    const sourcePath = "/Volumes/external/scan.tif";
    expect(formatRelativeOrAbsoluteFilePathForDisplay(sourcePath, projectFile)).toBe(
      "/Volumes/external/scan.tif",
    );
  });
});

describe("buildViewportImageMetadataDisplay", () => {
  it("builds full metadata for a raster source with the current data size", () => {
    const raster = buildSyntheticUint16RasterWithThreeBands();
    const display = buildViewportImageMetadataDisplay({
      fileName: "capture.tif",
      source: { kind: "raster", raster },
      originalFilePath: "/projects/demo/captures/capture.tif",
      currentProjectFilePath: "/projects/demo/session.ctproj",
    });
    expect(display).toEqual({
      filePath: "captures/capture.tif",
      format: "TIFF",
      width: "4",
      height: "4",
      bitsPerSample: "16",
      sampleFormat: "uint",
      bandCount: "3",
      dataSize: "96 B",
    });
  });

  it("uses placeholders for fields unavailable on browser sources", () => {
    const browserSource = buildSyntheticPixelsSource();
    const display = buildViewportImageMetadataDisplay({
      fileName: "photo.png",
      source: browserSource,
      originalFilePath: undefined,
      currentProjectFilePath: null,
    });
    expect(display.filePath).toBe("photo.png");
    expect(display.format).toBe("PNG");
    expect(display.bitsPerSample).toBe("-");
    expect(display.sampleFormat).toBe("-");
    expect(display.bandCount).toBe("-");
    expect(display.dataSize).toBe("-");
  });
});

interface SyntheticRasterShape {
  readonly width: number;
  readonly height: number;
  readonly bandCount: number;
  readonly bitsPerSample: number;
  readonly sampleFormat: RasterImage["sampleFormat"];
  readonly makeBand: (length: number) => RasterImage["bandPixels"][number];
}

function buildSyntheticRaster(shape: SyntheticRasterShape): RasterImage {
  const bandLength = shape.width * shape.height;
  return {
    width: shape.width,
    height: shape.height,
    bitsPerSample: shape.bitsPerSample,
    sampleFormat: shape.sampleFormat,
    bandCount: shape.bandCount,
    bandPixels: Array.from({ length: shape.bandCount }, () => shape.makeBand(bandLength)),
  };
}

function buildSyntheticUint16RasterWithThreeBands(): RasterImage {
  return buildSyntheticRaster({
    width: 4,
    height: 4,
    bandCount: 3,
    bitsPerSample: 16,
    sampleFormat: "uint",
    makeBand: (length) => new Uint16Array(length),
  });
}

function buildSyntheticPixelsSource(): ViewportImageSource {
  return {
    kind: "pixels",
    pixels: new Uint8ClampedArray(4 * 4 * 4),
    width: 4,
    height: 4,
  };
}
