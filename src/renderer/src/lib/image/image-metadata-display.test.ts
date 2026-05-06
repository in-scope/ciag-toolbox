import { describe, expect, it } from "vitest";

import {
  buildViewportImageMetadataDisplay,
  detectImageFormatFromFileName,
  formatFileSizeBytesForDisplay,
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

describe("formatFileSizeBytesForDisplay", () => {
  it("returns '-' for missing or invalid inputs", () => {
    expect(formatFileSizeBytesForDisplay(undefined)).toBe("-");
    expect(formatFileSizeBytesForDisplay(Number.NaN)).toBe("-");
    expect(formatFileSizeBytesForDisplay(-1)).toBe("-");
  });

  it("renders raw bytes when below 1 KB", () => {
    expect(formatFileSizeBytesForDisplay(0)).toBe("0 B");
    expect(formatFileSizeBytesForDisplay(512)).toBe("512 B");
    expect(formatFileSizeBytesForDisplay(1023)).toBe("1023 B");
  });

  it("renders kilobytes, megabytes, and gigabytes with one fractional digit", () => {
    expect(formatFileSizeBytesForDisplay(1024)).toBe("1.0 KB");
    expect(formatFileSizeBytesForDisplay(1536)).toBe("1.5 KB");
    expect(formatFileSizeBytesForDisplay(1024 * 1024)).toBe("1.0 MB");
    expect(formatFileSizeBytesForDisplay(2.5 * 1024 * 1024)).toBe("2.5 MB");
    expect(formatFileSizeBytesForDisplay(3 * 1024 * 1024 * 1024)).toBe("3.0 GB");
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
  it("builds full metadata for a raster source", () => {
    const raster = buildSyntheticUint16RasterWithThreeBands();
    const display = buildViewportImageMetadataDisplay({
      fileName: "capture.tif",
      source: { kind: "raster", raster },
      originalFilePath: "/projects/demo/captures/capture.tif",
      fileSizeBytes: 4 * 1024 * 1024,
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
      fileSize: "4.0 MB",
    });
  });

  it("uses placeholders for fields unavailable on browser sources", () => {
    const browserSource = buildSyntheticPixelsSource();
    const display = buildViewportImageMetadataDisplay({
      fileName: "photo.png",
      source: browserSource,
      originalFilePath: undefined,
      fileSizeBytes: undefined,
      currentProjectFilePath: null,
    });
    expect(display.filePath).toBe("photo.png");
    expect(display.format).toBe("PNG");
    expect(display.bitsPerSample).toBe("-");
    expect(display.sampleFormat).toBe("-");
    expect(display.bandCount).toBe("-");
    expect(display.fileSize).toBe("-");
  });
});

function buildSyntheticUint16RasterWithThreeBands(): RasterImage {
  return {
    width: 4,
    height: 4,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 3,
    bandPixels: [
      new Uint16Array(16),
      new Uint16Array(16),
      new Uint16Array(16),
    ],
  };
}

function buildSyntheticPixelsSource(): ViewportImageSource {
  return {
    kind: "pixels",
    pixels: new Uint8ClampedArray(4 * 4 * 4),
    width: 4,
    height: 4,
  };
}
