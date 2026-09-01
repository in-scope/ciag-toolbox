import {
  buildImportedMaskLayerContent,
  describeMaskDimensionMismatchOrNull,
  describeMaskFileDimensionMismatchOrNull,
  type MaskGridSize,
} from "@/lib/masks/mask-import";
import type { MaskLayerContent } from "@/lib/masks/mask-layer";
import {
  combineMaskFilesIntoOneLayer,
  refuseMoreMaskFilesThanCategories,
  type MaskFileToCombine,
} from "@/lib/masks/mask-multi-file-import";
import { decodeMaskPngBytes } from "@/lib/masks/mask-png-decode";
import { parseMaskSidecarDocumentOrNull } from "@/lib/masks/mask-sidecar";
import {
  buildMaskLayerContentFromZipEntries,
  type RefuseMaskFileThatDoesNotCoverTheStack,
} from "@/lib/masks/mask-zip-import";
import { readZipArchiveEntries } from "@/lib/masks/zip-store-reader";

// CT-303/CT-328: importing a mask picks one or more files through main
// (metadata plus each PNG's JSON sidecar), streams every file's bytes through
// the chunked opened-image read like any other picked file, and builds the
// layer in the renderer. A mask that does not cover the active stack's grid is
// refused before it can become a layer.
//
// The pick has three shapes, and each produces exactly ONE layer:
// - one PNG: the CT-303 import, sidecar-named when a sidecar sits beside it;
// - one zip: rebuilt losslessly from the toolbox's own pair inside it, or read
//   as one category per PNG entry (mask-zip-import.ts);
// - several PNGs: one category per file in pick order (mask-multi-file-import.ts).

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

interface PickedMaskFile {
  readonly file: ToolboxOpenImagesDialogFileMetadataEntry;
  readonly sidecarText: string | null;
}

const ZIP_FILE_EXTENSION = ".zip";

export async function importMaskLayerThroughOpenDialog(
  target: MaskImportTarget,
  api: MaskImportFlowApi = window.toolboxApi,
): Promise<MaskImportResult> {
  const picked = await api.importMaskDialog();
  if (picked.canceled) return { canceled: true };
  return {
    canceled: false,
    content: await buildLayerContentFromPickedFiles(target, picked.files, api),
  };
}

async function buildLayerContentFromPickedFiles(
  target: MaskImportTarget,
  files: ReadonlyArray<PickedMaskFile>,
  api: MaskImportFlowApi,
): Promise<MaskLayerContent> {
  const onlyPickedFile = files.length === 1 ? files[0] : undefined;
  if (onlyPickedFile === undefined) return buildLayerFromSeveralPngFiles(target, files, api);
  if (isZipFileName(onlyPickedFile.file.fileName)) {
    return buildLayerFromOneZipFile(target, onlyPickedFile, api);
  }
  return buildLayerFromOneMaskPng(target, onlyPickedFile, api);
}

function isZipFileName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(ZIP_FILE_EXTENSION);
}

async function buildLayerFromOneMaskPng(
  target: MaskImportTarget,
  picked: PickedMaskFile,
  api: MaskImportFlowApi,
): Promise<MaskLayerContent> {
  const decoded = await decodeMaskPngBytes(await readPickedFileBytes(api, picked));
  refuseMaskThatDoesNotCoverTheStack(decoded, target);
  return buildImportedMaskLayerContent({
    fileName: picked.file.fileName,
    decoded,
    sidecar: picked.sidecarText === null ? null : parseMaskSidecarDocumentOrNull(picked.sidecarText),
  });
}

async function buildLayerFromOneZipFile(
  target: MaskImportTarget,
  picked: PickedMaskFile,
  api: MaskImportFlowApi,
): Promise<MaskLayerContent> {
  const entries = await readZipArchiveEntries(await readPickedFileBytes(api, picked));
  return buildMaskLayerContentFromZipEntries(entries, buildStackCoverageGuard(target));
}

async function buildLayerFromSeveralPngFiles(
  target: MaskImportTarget,
  files: ReadonlyArray<PickedMaskFile>,
  api: MaskImportFlowApi,
): Promise<MaskLayerContent> {
  refuseMoreMaskFilesThanCategories(files.length);
  const decodedFiles = await Promise.all(
    files.map((picked) => decodePickedFileAsMaskFile(api, picked)),
  );
  const refuseMaskFile = buildStackCoverageGuard(target);
  decodedFiles.forEach((file) => refuseMaskFile(file.fileName, file.decoded));
  return combineMaskFilesIntoOneLayer(decodedFiles);
}

async function decodePickedFileAsMaskFile(
  api: MaskImportFlowApi,
  picked: PickedMaskFile,
): Promise<MaskFileToCombine> {
  return {
    fileName: picked.file.fileName,
    decoded: await decodeMaskPngBytes(await readPickedFileBytes(api, picked)),
  };
}

async function readPickedFileBytes(
  api: MaskImportFlowApi,
  picked: PickedMaskFile,
): Promise<Uint8Array> {
  return (await api.readOpenedImageFile(picked.file)).bytes;
}

function buildStackCoverageGuard(
  target: MaskImportTarget,
): RefuseMaskFileThatDoesNotCoverTheStack {
  return (fileName, decoded) => {
    const mismatch = describeMaskFileDimensionMismatchOrNull(
      fileName,
      decoded,
      target.width,
      target.height,
    );
    if (mismatch !== null) throw new Error(mismatch);
  };
}

// A single picked PNG keeps the original, file-name-free message: the user is
// looking at the one file they just chose.
function refuseMaskThatDoesNotCoverTheStack(
  decoded: MaskGridSize,
  target: MaskImportTarget,
): void {
  const mismatch = describeMaskDimensionMismatchOrNull(decoded, target.width, target.height);
  if (mismatch !== null) throw new Error(mismatch);
}
