import {
  encodeViewportSourceAsCanvasBlobBytes,
  readRgbaBytesFromBrowserSource,
} from "@/lib/image/encode-canvas";
import { encodeRasterImageAsEnviFiles } from "@/lib/image/encode-envi";
import {
  encodeRasterBandAsSingleChannelTiffBytes,
  encodeRgbaBytesAsRgbTiffBytes,
} from "@/lib/image/encode-tiff";
import {
  readSaveImageFormatTechnicalDetails,
  type SaveImageFormatId,
  type SaveImageFormatKind,
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
  const technicalDetails = readSaveImageFormatTechnicalDetails(input.formatId);
  return dispatchEncodingByFormatKind(input, technicalDetails.kind, technicalDetails.targetBitDepth);
}

async function dispatchEncodingByFormatKind(
  input: EncodeSavedImageInput,
  kind: SaveImageFormatKind,
  targetBitDepth: 8 | 16,
): Promise<EncodedSavedImage> {
  if (kind === "tiff") return encodeViewportSourceAsTiff(input, targetBitDepth);
  if (kind === "envi") return encodeViewportSourceAsEnviFiles(input);
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
): Promise<EncodedSavedImage> {
  if (input.source.kind === "raster") {
    const bytes = encodeRasterBandAsSingleChannelTiffBytes(
      input.source.raster,
      input.selectedBandIndex,
      targetBitDepth,
    );
    return { bytes };
  }
  const rgba = await readRgbaBytesFromBrowserSource(input.source);
  const bytes = encodeRgbaBytesAsRgbTiffBytes(rgba.rgba, rgba.width, rgba.height, targetBitDepth);
  return { bytes };
}

function encodeViewportSourceAsEnviFiles(
  input: EncodeSavedImageInput,
): EncodedSavedImage {
  rejectNonRasterSourceForEnviWrite(input.source);
  const encoded = encodeRasterImageAsEnviFiles(input.source.raster);
  return {
    bytes: encoded.headerBytes,
    sidecar: { extension: "bin", bytes: encoded.binaryBytes },
  };
}

function rejectNonRasterSourceForEnviWrite(
  source: ViewportImageSource,
): asserts source is Extract<ViewportImageSource, { kind: "raster" }> {
  if (source.kind !== "raster") {
    throw new Error("ENVI export is only supported for raster sources (TIFF, ENVI, raw)");
  }
}
