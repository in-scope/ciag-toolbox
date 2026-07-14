import { getImageSourceDimensions, type ViewportImageSource } from "@/lib/webgl/texture";

import {
  readSaveImageFormatTechnicalDetails,
  type SaveImageFormatId,
} from "@/lib/image/save-image-formats";

// CT-237: classic TIFF offsets are 32-bit, so no file over 4,294,967,295 bytes
// is representable (BigTIFF is a locked non-goal). Exports whose image content
// cannot fit are refused up front with this exact copy, before any encoding
// starts, so the app never writes an invalid file.
export const MAX_CLASSIC_TIFF_EXPORT_BYTES = 4_294_967_295;

export const TIFF_EXPORT_TOO_LARGE_MESSAGE =
  "TIFF export supports images up to 4 GB. Use ENVI export for larger stacks.";

export interface TiffExportContentDescription {
  readonly width: number;
  readonly height: number;
  readonly bandCount: number;
  readonly bytesPerSample: number;
}

// The estimate is the pixel-data byte size of the source's FULL image content
// (every band of a stack; three channels of a photo) at the chosen format's
// sample width. It is a floor on any classic-TIFF representation of the image
// (headers only add bytes), so refusing on it never rejects an export that
// could have fit.
export function estimateTiffExportBytes(content: TiffExportContentDescription): number {
  return content.width * content.height * content.bandCount * content.bytesPerSample;
}

export function wouldTiffExportExceedClassicTiffLimit(estimatedBytes: number): boolean {
  return estimatedBytes > MAX_CLASSIC_TIFF_EXPORT_BYTES;
}

export function findTiffExportRefusalMessageOrNull(
  source: ViewportImageSource,
  formatId: SaveImageFormatId,
): string | null {
  const content = describeTiffExportContentOrNull(source, formatId);
  if (content === null) return null;
  if (!wouldTiffExportExceedClassicTiffLimit(estimateTiffExportBytes(content))) return null;
  return TIFF_EXPORT_TOO_LARGE_MESSAGE;
}

function describeTiffExportContentOrNull(
  source: ViewportImageSource,
  formatId: SaveImageFormatId,
): TiffExportContentDescription | null {
  const details = readSaveImageFormatTechnicalDetails(formatId);
  if (details.kind !== "tiff") return null;
  const { width, height } = getImageSourceDimensions(source);
  return {
    width,
    height,
    bandCount: countSourceBands(source),
    bytesPerSample: readTiffBytesPerSampleForFormat(formatId),
  };
}

function countSourceBands(source: ViewportImageSource): number {
  if (source.kind === "raster") return source.raster.bandCount;
  return 3;
}

function readTiffBytesPerSampleForFormat(formatId: SaveImageFormatId): number {
  const details = readSaveImageFormatTechnicalDetails(formatId);
  if (details.targetSampleFormat === "float") return 4;
  return details.targetBitDepth / 8;
}
