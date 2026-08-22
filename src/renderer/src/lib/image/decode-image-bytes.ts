import {
  assertSixteenBitPngHeaderIsDecodable,
  isSixteenBitPngFileHeader,
  parsePngFileHeaderOrNull,
  type PngFileHeaderSummary,
} from "@shared/png-header";

import { type UnitProgressCallback } from "@/lib/image/unit-progress";
import { loadEnviAsRasterReportingPerBandProgress } from "@/lib/image/load-envi";
import {
  loadPng16RasterThroughChunkedDecode,
  type Png16DecodeApi,
} from "@/lib/image/load-png16";
import { loadRawAsRaster } from "@/lib/image/load-raw";
import { loadTiffAsRaster } from "@/lib/image/load-tiff";
import { promoteBrowserSourceToRaster } from "@/lib/image/promote-source-to-raster";
import type { ViewportImageSource } from "@/lib/webgl/texture";

export interface OpenedImageBundle {
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly sidecarBytes?: Uint8Array;
  // CT-272: 16-bit PNGs decode in MAIN from the file on disk (Chromium's own
  // decoder downscales them to 8 bits), so the open flows pass the path along.
  readonly filePath?: string;
}

const RAW_CAMERA_FILE_EXTENSIONS: ReadonlyArray<string> = [
  ".dng",
  ".cr3",
  ".arw",
  ".nef",
  ".raf",
  ".orf",
  ".pef",
  ".rw2",
];

export async function decodeImageBytesToViewportSource(
  bundle: OpenedImageBundle,
  onDecodeProgress?: UnitProgressCallback,
): Promise<ViewportImageSource> {
  if (looksLikeEnviHeaderFileName(bundle.fileName)) {
    return decodeEnviHeaderAndBinaryAsRasterSource(bundle, onDecodeProgress);
  }
  if (looksLikeRawCameraFileName(bundle.fileName)) {
    return decodeRawCameraBytesAsRasterSource(bundle.bytes);
  }
  if (looksLikeTiffFileName(bundle.fileName) || looksLikeTiffByteHeader(bundle.bytes)) {
    return decodeTiffBytesAsRasterSource(bundle.bytes, onDecodeProgress);
  }
  const pngHeader = parsePngFileHeaderOrNull(bundle.bytes);
  if (isSixteenBitPngFileHeader(pngHeader)) {
    return decodeSixteenBitPngThroughMainProcess(bundle, pngHeader, onDecodeProgress);
  }
  return decodeBrowserImageBytesAsPromotedRasterSource(bundle.bytes);
}

// CT-272: a 16-bit PNG never goes near createImageBitmap (which silently
// downscales it to 8 bits); main decodes it with Node zlib and streams the
// real uint16 samples back through the chunked protocol.
async function decodeSixteenBitPngThroughMainProcess(
  bundle: OpenedImageBundle,
  pngHeader: PngFileHeaderSummary,
  onDecodeProgress?: UnitProgressCallback,
): Promise<ViewportImageSource> {
  assertSixteenBitPngHeaderIsDecodable(pngHeader);
  if (bundle.filePath === undefined) {
    throw new Error(`Cannot decode ${bundle.fileName}: 16-bit PNG decoding needs the file's path`);
  }
  const raster = await loadPng16RasterThroughChunkedDecode(
    buildPng16DecodeApiFromToolboxBridge(),
    bundle.filePath,
    onDecodeProgress,
  );
  return { kind: "raster", raster };
}

function buildPng16DecodeApiFromToolboxBridge(): Png16DecodeApi {
  return {
    begin: (request) => window.toolboxApi.beginPng16Decode(request),
    readChunk: (request) => window.toolboxApi.readPng16DecodedChunk(request),
    finish: (request) => window.toolboxApi.finishPng16Decode(request),
    abort: (request) => window.toolboxApi.abortPng16Decode(request),
  };
}

async function decodeEnviHeaderAndBinaryAsRasterSource(
  bundle: OpenedImageBundle,
  onDecodeProgress?: UnitProgressCallback,
): Promise<ViewportImageSource> {
  if (!bundle.sidecarBytes) {
    throw new Error(
      `ENVI header ${bundle.fileName} requires a sibling binary file (.bin/.dat/.img) but none was provided`,
    );
  }
  const raster = await loadEnviAsRasterReportingPerBandProgress(
    bundle.bytes,
    bundle.sidecarBytes,
    onDecodeProgress,
  );
  return { kind: "raster", raster };
}

async function decodeTiffBytesAsRasterSource(
  bytes: Uint8Array,
  onDecodeProgress?: UnitProgressCallback,
): Promise<ViewportImageSource> {
  const raster = await loadTiffAsRaster(bytes, onDecodeProgress);
  return { kind: "raster", raster };
}

async function decodeRawCameraBytesAsRasterSource(
  bytes: Uint8Array,
): Promise<ViewportImageSource> {
  const raster = await loadRawAsRaster(bytes);
  return { kind: "raster", raster };
}

// CT-263: browser decodes (PNG/JPG) are promoted to rasters HERE, before the
// open-images grouping, so the review classification keys on the decoded band
// count: a grayscale photo is a stackable single-band plane, a colour photo a
// 3-band rgb composite that opens on its own.
async function decodeBrowserImageBytesAsPromotedRasterSource(
  bytes: Uint8Array,
): Promise<ViewportImageSource> {
  const blob = new Blob([copyBytesToOwnArrayBuffer(bytes)]);
  const bitmap = await createImageBitmap(blob);
  try {
    return { kind: "raster", raster: promoteBrowserSourceToRaster({ kind: "image-bitmap", image: bitmap }) };
  } finally {
    bitmap.close();
  }
}

// Exported so the open flow can route .hdr files to the CT-231 streaming
// ENVI decode path before any whole-file read happens.
export function looksLikeEnviHeaderFileName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".hdr");
}

function looksLikeTiffFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".tif") || lower.endsWith(".tiff");
}

function looksLikeRawCameraFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return RAW_CAMERA_FILE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function looksLikeTiffByteHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  return isLittleEndianTiffHeader(bytes) || isBigEndianTiffHeader(bytes);
}

function isLittleEndianTiffHeader(bytes: Uint8Array): boolean {
  return bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00;
}

function isBigEndianTiffHeader(bytes: Uint8Array): boolean {
  return bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a;
}

function copyBytesToOwnArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}
