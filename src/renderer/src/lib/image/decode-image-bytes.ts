import { loadTiffAsRaster } from "@/lib/image/load-tiff";
import type { ViewportImageSource } from "@/lib/webgl/texture";

export async function decodeImageBytesToViewportSource(
  fileName: string,
  bytes: Uint8Array,
): Promise<ViewportImageSource> {
  if (looksLikeTiffFileName(fileName) || looksLikeTiffByteHeader(bytes)) {
    return decodeTiffBytesAsRasterSource(bytes);
  }
  return decodeBrowserImageBytesAsBitmapSource(bytes);
}

async function decodeTiffBytesAsRasterSource(
  bytes: Uint8Array,
): Promise<ViewportImageSource> {
  const raster = await loadTiffAsRaster(bytes);
  return { kind: "raster", raster };
}

async function decodeBrowserImageBytesAsBitmapSource(
  bytes: Uint8Array,
): Promise<ViewportImageSource> {
  const blob = new Blob([copyBytesToOwnArrayBuffer(bytes)]);
  const bitmap = await createImageBitmap(blob);
  return { kind: "image-bitmap", image: bitmap };
}

function looksLikeTiffFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".tif") || lower.endsWith(".tiff");
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
