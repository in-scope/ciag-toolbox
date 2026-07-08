import { decodeImageBytesToViewportSource } from "@/lib/image/decode-image-bytes";
import { type UnitProgressCallback } from "@/lib/image/unit-progress";
import {
  proposeGroupsForOpenedFiles,
  type OpenedFileForGrouping,
  type OpenedFilesGroupingProposal,
} from "@/lib/image/group-opened-files";
import type { BusyEntryHandle } from "@/state/busy-state-context";

export type RunOpenImagesDialogResult =
  | { readonly kind: "canceled" }
  // CT-220: the single-file fast path returns the METADATA only; the caller reads and
  // decodes it via readAndDecodeSingleOpenedImageFile so decode progress can drive a
  // busy entry on the destination viewport instead of the app-wide read modal.
  | { readonly kind: "single-file"; readonly metadata: ToolboxOpenImagesDialogFileMetadataEntry }
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
    return { kind: "single-file", metadata: dialogResult.files[0]! };
  }
  return readAllFilesAndProposeGroups(dialogResult.files, options.readPhaseBusyHandle);
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
    decoded.push(await readAndDecodeOneFileOfMany(metadata, index, files.length, handle));
  }
  return decoded;
}

async function readAndDecodeOneFileOfMany(
  metadata: ToolboxOpenImagesDialogFileMetadataEntry,
  index: number,
  totalCount: number,
  handle: BusyEntryHandle,
): Promise<OpenedFileForGrouping> {
  reportReadProgress(handle, index, totalCount, metadata.fileName, 0);
  return readAndDecodeSingleOpenedImageFile(metadata, (withinFileFraction) =>
    reportReadProgress(handle, index, totalCount, metadata.fileName, withinFileFraction),
  );
}

// CT-220: the fraction counts decode UNITS - one file in a multi-file open, refined by
// the current file's own per-band/per-page decode fraction as it streams in.
function reportReadProgress(
  handle: BusyEntryHandle,
  zeroBasedIndex: number,
  totalCount: number,
  fileName: string,
  withinFileFraction: number,
): void {
  handle.update({
    label: `Reading ${zeroBasedIndex + 1} of ${totalCount}: ${fileName}...`,
    progress: (zeroBasedIndex + withinFileFraction) / Math.max(1, totalCount),
  });
}

export async function readAndDecodeSingleOpenedImageFile(
  metadata: ToolboxOpenImagesDialogFileMetadataEntry,
  onDecodeProgress?: UnitProgressCallback,
): Promise<OpenedFileForGrouping> {
  const entry = await window.toolboxApi.readOpenedImageFile(metadata);
  const decoded = await tryDecodeOpenedImageEntry(entry, onDecodeProgress);
  return buildOpenedFileForGroupingFromEntry(entry, decoded);
}

interface DecodedSourceOrError {
  readonly source: Awaited<ReturnType<typeof decodeImageBytesToViewportSource>> | null;
  readonly errorMessage: string | null;
}

async function tryDecodeOpenedImageEntry(
  entry: ToolboxOpenedImagesFileEntry,
  onDecodeProgress?: UnitProgressCallback,
): Promise<DecodedSourceOrError> {
  try {
    const source = await decodeImageBytesToViewportSource(
      {
        fileName: entry.fileName,
        bytes: entry.bytes,
        ...(entry.sidecar ? { sidecarBytes: entry.sidecar.bytes } : {}),
      },
      onDecodeProgress,
    );
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
