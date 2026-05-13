import { decodeImageBytesToViewportSource } from "@/lib/image/decode-image-bytes";
import {
  proposeGroupsForOpenedFiles,
  type OpenedFileForGrouping,
  type OpenedFilesGroupingProposal,
} from "@/lib/image/group-opened-files";
import type { BusyEntryHandle } from "@/state/busy-state-context";

export type RunOpenImagesDialogResult =
  | { readonly kind: "canceled" }
  | { readonly kind: "single-file"; readonly file: OpenedFileForGrouping }
  | { readonly kind: "review"; readonly proposal: OpenedFilesGroupingProposal };

interface RunOpenImagesDialogOptions {
  readonly readPhaseBusyHandle: BusyEntryHandle;
}

export async function runOpenImagesDialogPhase(
  options: RunOpenImagesDialogOptions,
): Promise<RunOpenImagesDialogResult> {
  const dialogResult = await window.toolboxApi.openImagesDialog();
  if (dialogResult.canceled) return { kind: "canceled" };
  if (dialogResult.files.length === 0) return { kind: "canceled" };
  if (dialogResult.files.length === 1) {
    return readSingleFileForFastPath(dialogResult.files[0]!, options.readPhaseBusyHandle);
  }
  return readAllFilesAndProposeGroups(dialogResult.files, options.readPhaseBusyHandle);
}

async function readSingleFileForFastPath(
  metadata: ToolboxOpenImagesDialogFileMetadataEntry,
  handle: BusyEntryHandle,
): Promise<RunOpenImagesDialogResult> {
  reportReadProgress(handle, 0, 1, metadata.fileName);
  const file = await readAndDecodeSingleOpenedImageFile(metadata);
  return { kind: "single-file", file };
}

async function readAllFilesAndProposeGroups(
  files: ReadonlyArray<ToolboxOpenImagesDialogFileMetadataEntry>,
  handle: BusyEntryHandle,
): Promise<RunOpenImagesDialogResult> {
  const decoded = await readAndDecodeAllOpenedImageFilesSequentially(files, handle);
  return { kind: "review", proposal: proposeGroupsForOpenedFiles(decoded) };
}

async function readAndDecodeAllOpenedImageFilesSequentially(
  files: ReadonlyArray<ToolboxOpenImagesDialogFileMetadataEntry>,
  handle: BusyEntryHandle,
): Promise<ReadonlyArray<OpenedFileForGrouping>> {
  const decoded: OpenedFileForGrouping[] = [];
  for (let index = 0; index < files.length; index++) {
    const metadata = files[index];
    if (metadata === undefined) continue;
    reportReadProgress(handle, index, files.length, metadata.fileName);
    decoded.push(await readAndDecodeSingleOpenedImageFile(metadata));
  }
  return decoded;
}

function reportReadProgress(
  handle: BusyEntryHandle,
  zeroBasedIndex: number,
  totalCount: number,
  fileName: string,
): void {
  handle.update({
    label: `Reading ${zeroBasedIndex + 1} of ${totalCount}: ${fileName}...`,
    progress: zeroBasedIndex / Math.max(1, totalCount),
  });
}

async function readAndDecodeSingleOpenedImageFile(
  metadata: ToolboxOpenImagesDialogFileMetadataEntry,
): Promise<OpenedFileForGrouping> {
  const entry = await window.toolboxApi.readOpenedImageFile(metadata);
  const decoded = await tryDecodeOpenedImageEntry(entry);
  return buildOpenedFileForGroupingFromEntry(entry, decoded);
}

interface DecodedSourceOrError {
  readonly source: Awaited<ReturnType<typeof decodeImageBytesToViewportSource>> | null;
  readonly errorMessage: string | null;
}

async function tryDecodeOpenedImageEntry(
  entry: ToolboxOpenedImagesFileEntry,
): Promise<DecodedSourceOrError> {
  try {
    const source = await decodeImageBytesToViewportSource({
      fileName: entry.fileName,
      bytes: entry.bytes,
      ...(entry.sidecar ? { sidecarBytes: entry.sidecar.bytes } : {}),
    });
    return { source, errorMessage: null };
  } catch (error) {
    return { source: null, errorMessage: convertUnknownErrorToMessage(error) };
  }
}

function convertUnknownErrorToMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function buildOpenedFileForGroupingFromEntry(
  entry: ToolboxOpenedImagesFileEntry,
  decoded: DecodedSourceOrError,
): OpenedFileForGrouping {
  return {
    fileName: entry.fileName,
    filePath: entry.filePath,
    fileSizeBytes: entry.fileSizeBytes,
    mtimeMs: entry.mtimeMs,
    source: decoded.source,
    decodeError: decoded.errorMessage,
    contentHash: entry.contentHash,
    bytes: entry.bytes,
    ...(entry.sidecar ? { sidecarBytes: entry.sidecar.bytes, sidecarFileName: entry.sidecar.fileName } : {}),
  };
}
