import { decodeImageBytesToViewportSource } from "@/lib/image/decode-image-bytes";
import type { RasterImage } from "@/lib/image/raster-image";
import { rememberReferenceRaster } from "@/lib/image/reference-raster-store";

// CT-078: opens the native file dialog, decodes the chosen file with the existing
// raster loaders, and remembers the resulting cube so the flat-field action can
// resolve it synchronously at apply time. Returns null when the user cancels.

export interface PickedReferenceRaster {
  readonly token: string;
  readonly fileName: string;
  readonly raster: RasterImage;
}

export async function pickAndRememberReferenceRasterFromDisk(): Promise<PickedReferenceRaster | null> {
  const dialogResult = await window.toolboxApi.openImageDialog();
  if (dialogResult.canceled) return null;
  const raster = await decodeDialogResultToRasterOrThrow(dialogResult);
  rememberReferenceRaster(dialogResult.filePath, raster);
  return { token: dialogResult.filePath, fileName: dialogResult.fileName, raster };
}

type OpenedImageDialogFile = Extract<ToolboxOpenImageDialogResult, { canceled: false }>;

async function decodeDialogResultToRasterOrThrow(file: OpenedImageDialogFile): Promise<RasterImage> {
  const source = await decodeImageBytesToViewportSource({
    fileName: file.fileName,
    bytes: file.bytes,
    ...(file.sidecar ? { sidecarBytes: file.sidecar.bytes } : {}),
  });
  if (source.kind !== "raster") {
    throw new Error(
      `${file.fileName} is not a raster image (TIFF, ENVI, or raw camera). Pick a raster reference stack.`,
    );
  }
  return source.raster;
}
