import { loadEnviAsRaster } from "@/lib/image/load-envi";
import { loadRawAsRaster } from "@/lib/image/load-raw";
import { loadTiffAsRaster } from "@/lib/image/load-tiff";
import type { ViewportImageSource } from "@/lib/webgl/texture";

export interface OpenedImageBundle {
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly sidecarBytes?: Uint8Array;
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
): Promise<ViewportImageSource> {
  if (looksLikeEnviHeaderFileName(bundle.fileName)) {
    return decodeEnviHeaderAndBinaryAsRasterSource(bundle);
  }
  if (looksLikeRawCameraFileName(bundle.fileName)) {
    return decodeRawCameraBytesAsRasterSource(bundle.bytes);
  }
  if (looksLikeTiffFileName(bundle.fileName) || looksLikeTiffByteHeader(bundle.bytes)) {
    return decodeTiffBytesAsRasterSource(bundle.bytes);
  }
  return decodeBrowserImageBytesAsBitmapSource(bundle.bytes);
}

function decodeEnviHeaderAndBinaryAsRasterSource(
  bundle: OpenedImageBundle,
): ViewportImageSource {
  if (!bundle.sidecarBytes) {
    throw new Error(
      `ENVI header ${bundle.fileName} requires a sibling binary file (.bin/.dat/.img) but none was provided`,
    );
  }
  const raster = loadEnviAsRaster(bundle.bytes, bundle.sidecarBytes);
  return { kind: "raster", raster };
}

async function decodeTiffBytesAsRasterSource(
  bytes: Uint8Array,
): Promise<ViewportImageSource> {
  const raster = await loadTiffAsRaster(bytes);
  return { kind: "raster", raster };
}

async function decodeRawCameraBytesAsRasterSource(
  bytes: Uint8Array,
): Promise<ViewportImageSource> {
  const raster = await loadRawAsRaster(bytes);
  return { kind: "raster", raster };
}

async function decodeBrowserImageBytesAsBitmapSource(
  bytes: Uint8Array,
): Promise<ViewportImageSource> {
  const blob = new Blob([copyBytesToOwnArrayBuffer(bytes)]);
  const bitmap = await createImageBitmap(blob);
  return { kind: "image-bitmap", image: bitmap };
}

function looksLikeEnviHeaderFileName(fileName: string): boolean {
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
