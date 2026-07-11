import {
  encodeViewportSourceAsCanvasBlobBytes,
  readRgbaBytesFromBrowserSource,
} from "@/lib/image/encode-canvas";
import {
  encodeRasterImageAsEnviFilesReportingProgress,
  encodeRasterImageAsFloat32EnviFilesReportingProgress,
  type EnviEncodedFiles,
} from "@/lib/image/encode-envi";
import {
  encodeRasterBandAsFloat32TiffBytesReportingProgress,
  encodeRasterBandAsSingleChannelTiffBytesReportingProgress,
  encodeRgbaBytesAsRgbTiffBytesReportingProgress,
  encodeRgbRasterAsRgbTiffBytesReportingProgress,
} from "@/lib/image/encode-tiff";
import { shouldRenderRasterAsRgbComposite } from "@/lib/image/raster-color-interpretation";
import {
  readSaveImageFormatTechnicalDetails,
  type SaveImageFormatId,
  type SaveImageFormatKind,
  type SaveImageSampleFormat,
} from "@/lib/image/save-image-formats";
import type { UnitProgressCallback } from "@/lib/image/unit-progress";
import type { ViewportImageSource } from "@/lib/webgl/texture";

export interface EncodeSavedImageInput {
  readonly source: ViewportImageSource;
  readonly selectedBandIndex: number;
  readonly formatId: SaveImageFormatId;
  // CT-219f: TIFF and ENVI encodes report determinate 0..1 progress; the canvas
  // formats (PNG, JPEG) are single-shot and keep the indeterminate spinner.
  readonly onProgress?: UnitProgressCallback;
}

export interface EncodedSavedImageSidecarFile {
  readonly extension: string;
  readonly bytes: Uint8Array;
}

export interface EncodedSavedImage {
  readonly bytes: Uint8Array;
  readonly sidecar?: EncodedSavedImageSidecarFile;
}

export async function encodeViewportSourceForSaving(
  input: EncodeSavedImageInput,
): Promise<EncodedSavedImage> {
  const details = readSaveImageFormatTechnicalDetails(input.formatId);
  return dispatchEncodingByFormatKind(input, details.kind, details.targetBitDepth, details.targetSampleFormat);
}

async function dispatchEncodingByFormatKind(
  input: EncodeSavedImageInput,
  kind: SaveImageFormatKind,
  targetBitDepth: 8 | 16,
  targetSampleFormat: SaveImageSampleFormat,
): Promise<EncodedSavedImage> {
  if (kind === "tiff") return encodeViewportSourceAsTiff(input, targetBitDepth, targetSampleFormat);
  if (kind === "envi") return encodeViewportSourceAsEnviFiles(input, targetSampleFormat);
  return encodeViewportSourceAsCanvasBlob(input, kind);
}

async function encodeViewportSourceAsCanvasBlob(
  input: EncodeSavedImageInput,
  kind: SaveImageFormatKind,
): Promise<EncodedSavedImage> {
  const bytes = await encodeViewportSourceAsCanvasBlobBytes(input.source, input.selectedBandIndex, {
    mimeType: kind === "png" ? "image/png" : "image/jpeg",
  });
  return { bytes };
}

async function encodeViewportSourceAsTiff(
  input: EncodeSavedImageInput,
  targetBitDepth: 8 | 16,
  targetSampleFormat: SaveImageSampleFormat,
): Promise<EncodedSavedImage> {
  if (input.source.kind === "raster") {
    const bytes = await encodeRasterBandAsTiffBytesReportingProgress(
      input.source.raster,
      input.selectedBandIndex,
      targetBitDepth,
      targetSampleFormat,
      input.onProgress,
    );
    return { bytes };
  }
  const rgba = await readRgbaBytesFromBrowserSource(input.source);
  const bytes = await encodeRgbaBytesAsRgbTiffBytesReportingProgress(
    rgba.rgba,
    rgba.width,
    rgba.height,
    targetBitDepth,
    input.onProgress,
  );
  return { bytes };
}

async function encodeRasterBandAsTiffBytesReportingProgress(
  raster: Extract<ViewportImageSource, { kind: "raster" }>["raster"],
  selectedBandIndex: number,
  targetBitDepth: 8 | 16,
  targetSampleFormat: SaveImageSampleFormat,
  onProgress: UnitProgressCallback | undefined,
): Promise<Uint8Array> {
  if (targetSampleFormat === "float") {
    return encodeRasterBandAsFloat32TiffBytesReportingProgress(raster, selectedBandIndex, onProgress);
  }
  if (shouldRenderRasterAsRgbComposite(raster)) {
    return encodeRgbRasterAsRgbTiffBytesReportingProgress(raster, targetBitDepth, onProgress);
  }
  return encodeRasterBandAsSingleChannelTiffBytesReportingProgress(
    raster,
    selectedBandIndex,
    targetBitDepth,
    onProgress,
  );
}

async function encodeViewportSourceAsEnviFiles(
  input: EncodeSavedImageInput,
  targetSampleFormat: SaveImageSampleFormat,
): Promise<EncodedSavedImage> {
  rejectNonRasterSourceForEnviWrite(input.source);
  const encoded = await encodeEnviFilesForSampleFormatReportingProgress(
    input.source.raster,
    targetSampleFormat,
    input.onProgress,
  );
  return {
    bytes: encoded.headerBytes,
    sidecar: { extension: "bin", bytes: encoded.binaryBytes },
  };
}

async function encodeEnviFilesForSampleFormatReportingProgress(
  raster: Extract<ViewportImageSource, { kind: "raster" }>["raster"],
  targetSampleFormat: SaveImageSampleFormat,
  onProgress: UnitProgressCallback | undefined,
): Promise<EnviEncodedFiles> {
  if (targetSampleFormat === "float") {
    return encodeRasterImageAsFloat32EnviFilesReportingProgress(raster, onProgress);
  }
  return encodeRasterImageAsEnviFilesReportingProgress(raster, onProgress);
}

function rejectNonRasterSourceForEnviWrite(
  source: ViewportImageSource,
): asserts source is Extract<ViewportImageSource, { kind: "raster" }> {
  if (source.kind !== "raster") {
    throw new Error("ENVI export is only supported for raster sources (TIFF, ENVI, raw)");
  }
}
