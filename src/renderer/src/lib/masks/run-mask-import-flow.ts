import {
  buildImportedMaskLayerContent,
  describeMaskDimensionMismatchOrNull,
  type MaskGridSize,
} from "@/lib/masks/mask-import";
import type { MaskLayerContent } from "@/lib/masks/mask-layer";
import { decodeMaskPngBytes } from "@/lib/masks/mask-png-decode";
import { parseMaskSidecarDocumentOrNull } from "@/lib/masks/mask-sidecar";

// CT-303: importing a mask picks the PNG through main (metadata plus the JSON
// sidecar), streams the file's bytes through the chunked opened-image read
// like any other picked file, and decodes the category indexes in the
// renderer. A mask that does not cover the active stack's grid is refused
// before it can become a layer.

export interface MaskImportTarget {
  readonly width: number;
  readonly height: number;
}

export type MaskImportResult =
  | { readonly canceled: true }
  | { readonly canceled: false; readonly content: MaskLayerContent };

export interface MaskImportFlowApi {
  importMaskDialog(): Promise<ToolboxMaskImportDialogResult>;
  readOpenedImageFile(
    metadata: ToolboxOpenImagesDialogFileMetadataEntry,
  ): Promise<ToolboxOpenedImagesFileEntry>;
}

export async function importMaskLayerThroughOpenDialog(
  target: MaskImportTarget,
  api: MaskImportFlowApi = window.toolboxApi,
): Promise<MaskImportResult> {
  const picked = await api.importMaskDialog();
  if (picked.canceled) return { canceled: true };
  const entry = await api.readOpenedImageFile(picked.file);
  return {
    canceled: false,
    content: await buildLayerContentFromPickedMask(target, picked, entry.bytes),
  };
}

async function buildLayerContentFromPickedMask(
  target: MaskImportTarget,
  picked: { file: ToolboxOpenImagesDialogFileMetadataEntry; sidecarText: string | null },
  fileBytes: Uint8Array,
): Promise<MaskLayerContent> {
  const decoded = await decodeMaskPngBytes(fileBytes);
  refuseMaskThatDoesNotCoverTheStack(decoded, target);
  return buildImportedMaskLayerContent({
    fileName: picked.file.fileName,
    decoded,
    sidecar: picked.sidecarText === null ? null : parseMaskSidecarDocumentOrNull(picked.sidecarText),
  });
}

function refuseMaskThatDoesNotCoverTheStack(
  decoded: MaskGridSize,
  target: MaskImportTarget,
): void {
  const mismatch = describeMaskDimensionMismatchOrNull(decoded, target.width, target.height);
  if (mismatch !== null) throw new Error(mismatch);
}
