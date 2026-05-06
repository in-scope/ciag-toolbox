import {
  encodeViewportSourceAsCanvasBlobBytes,
  readRgbaBytesFromBrowserSource,
} from "@/lib/image/encode-canvas";
import {
  encodeRasterBandAsSingleChannelTiffBytes,
  encodeRgbaBytesAsRgbTiffBytes,
} from "@/lib/image/encode-tiff";
import {
  readSaveImageFormatTechnicalDetails,
  type SaveImageFormatId,
} from "@/lib/image/save-image-formats";
import type { ViewportImageSource } from "@/lib/webgl/texture";

export interface EncodeSavedImageInput {
  readonly source: ViewportImageSource;
  readonly selectedBandIndex: number;
  readonly formatId: SaveImageFormatId;
}

export async function encodeViewportSourceForSaving(
  input: EncodeSavedImageInput,
): Promise<Uint8Array> {
  const technicalDetails = readSaveImageFormatTechnicalDetails(input.formatId);
  if (technicalDetails.kind === "tiff") {
    return encodeViewportSourceAsTiff(input, technicalDetails.targetBitDepth);
  }
  return encodeViewportSourceAsCanvasBlobBytes(input.source, input.selectedBandIndex, {
    mimeType: technicalDetails.kind === "png" ? "image/png" : "image/jpeg",
  });
}

async function encodeViewportSourceAsTiff(
  input: EncodeSavedImageInput,
  targetBitDepth: 8 | 16,
): Promise<Uint8Array> {
  if (input.source.kind === "raster") {
    return encodeRasterBandAsSingleChannelTiffBytes(
      input.source.raster,
      input.selectedBandIndex,
      targetBitDepth,
    );
  }
  const rgba = await readRgbaBytesFromBrowserSource(input.source);
  return encodeRgbaBytesAsRgbTiffBytes(rgba.rgba, rgba.width, rgba.height, targetBitDepth);
}
