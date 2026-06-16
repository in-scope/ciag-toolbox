import {
  encodeViewportSourceAsCanvasBlobBytes,
  readRgbaBytesFromBrowserSource,
} from "@/lib/image/encode-canvas";
import {
  encodeRasterImageAsEnviFiles,
  encodeRasterImageAsFloat32EnviFiles,
} from "@/lib/image/encode-envi";
import {
  encodeRasterBandAsFloat32TiffBytes,
  encodeRasterBandAsSingleChannelTiffBytes,
  encodeRgbaBytesAsRgbTiffBytes,
  encodeRgbRasterAsRgbTiffBytes,
} from "@/lib/image/encode-tiff";
import { shouldRenderRasterAsRgbComposite } from "@/lib/image/raster-color-interpretation";
import {
  readSaveImageFormatTechnicalDetails,
  type SaveImageFormatId,
  type SaveImageFormatKind,
  type SaveImageSampleFormat,
} from "@/lib/image/save-image-formats";
import type { ViewportImageSource } from "@/lib/webgl/texture";

export interface EncodeSavedImageInput {
  readonly source: ViewportImageSource;
  readonly selectedBandIndex: number;
  readonly formatId: SaveImageFormatId;
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
    const bytes = encodeRasterBandAsTiffBytes(
      input.source.raster,
      input.selectedBandIndex,
      targetBitDepth,
      targetSampleFormat,
    );
    return { bytes };
  }
  const rgba = await readRgbaBytesFromBrowserSource(input.source);
  const bytes = encodeRgbaBytesAsRgbTiffBytes(rgba.rgba, rgba.width, rgba.height, targetBitDepth);
  return { bytes };
}

function encodeRasterBandAsTiffBytes(
  raster: Extract<ViewportImageSource, { kind: "raster" }>["raster"],
  selectedBandIndex: number,
  targetBitDepth: 8 | 16,
  targetSampleFormat: SaveImageSampleFormat,
): Uint8Array {
  if (targetSampleFormat === "float") {
    return encodeRasterBandAsFloat32TiffBytes(raster, selectedBandIndex);
  }
  if (shouldRenderRasterAsRgbComposite(raster)) {
    return encodeRgbRasterAsRgbTiffBytes(raster, targetBitDepth);
  }
  return encodeRasterBandAsSingleChannelTiffBytes(raster, selectedBandIndex, targetBitDepth);
}

function encodeViewportSourceAsEnviFiles(
  input: EncodeSavedImageInput,
  targetSampleFormat: SaveImageSampleFormat,
): EncodedSavedImage {
  rejectNonRasterSourceForEnviWrite(input.source);
  const encoded = encodeEnviFilesForSampleFormat(input.source.raster, targetSampleFormat);
  return {
    bytes: encoded.headerBytes,
    sidecar: { extension: "bin", bytes: encoded.binaryBytes },
  };
}

function encodeEnviFilesForSampleFormat(
  raster: Extract<ViewportImageSource, { kind: "raster" }>["raster"],
  targetSampleFormat: SaveImageSampleFormat,
): ReturnType<typeof encodeRasterImageAsEnviFiles> {
  if (targetSampleFormat === "float") return encodeRasterImageAsFloat32EnviFiles(raster);
  return encodeRasterImageAsEnviFiles(raster);
}

function rejectNonRasterSourceForEnviWrite(
  source: ViewportImageSource,
): asserts source is Extract<ViewportImageSource, { kind: "raster" }> {
  if (source.kind !== "raster") {
    throw new Error("ENVI export is only supported for raster sources (TIFF, ENVI, raw)");
  }
}
