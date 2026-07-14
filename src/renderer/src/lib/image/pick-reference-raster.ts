import type { RasterImage } from "@/lib/image/raster-image";
import { rememberReferenceRaster } from "@/lib/image/reference-raster-store";
import { readAndDecodeSingleOpenedImageFileOrThrow } from "@/lib/image/run-open-images-flow";

// CT-078 / CT-234: opens the native file dialog (a metadata-only reply), reads
// and decodes the chosen file through the chunked opened-image protocol (so a
// reference larger than 2 GiB works like the main open path), and remembers the
// resulting cube so the flat-field action can resolve it synchronously at apply
// time. Returns null when the user cancels.

export interface PickedReferenceRaster {
  readonly token: string;
  readonly fileName: string;
  readonly raster: RasterImage;
}

export async function pickAndRememberReferenceRasterFromDisk(): Promise<PickedReferenceRaster | null> {
  const dialogResult = await window.toolboxApi.openImageDialog();
  if (dialogResult.canceled) return null;
  const raster = await readAndDecodeReferenceRasterOrThrow(dialogResult.file);
  rememberReferenceRaster(dialogResult.file.filePath, raster);
  return { token: dialogResult.file.filePath, fileName: dialogResult.file.fileName, raster };
}

async function readAndDecodeReferenceRasterOrThrow(
  metadata: ToolboxOpenImagesDialogFileMetadataEntry,
): Promise<RasterImage> {
  const decoded = await readAndDecodeSingleOpenedImageFileOrThrow(metadata);
  if (decoded.source.kind !== "raster") {
    throw new Error(
      `${metadata.fileName} is not a raster image (TIFF, ENVI, or raw camera). Pick a raster reference stack.`,
    );
  }
  return decoded.source.raster;
}
