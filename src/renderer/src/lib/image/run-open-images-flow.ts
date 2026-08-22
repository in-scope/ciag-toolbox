import {
  decodeImageBytesToViewportSource,
  looksLikeEnviHeaderFileName,
} from "@/lib/image/decode-image-bytes";
import { type UnitProgressCallback } from "@/lib/image/unit-progress";
import {
  proposeGroupsForOpenedFiles,
  type OpenedFileForGrouping,
  type OpenedFilesGroupingProposal,
} from "@/lib/image/group-opened-files";
import {
  assertAllocationFitsRemainingBudget,
  buildOpenSingleImageMemoryRefusalMessage,
  OPEN_IMAGES_MEMORY_REFUSAL_MESSAGE,
} from "@/lib/image/raster-memory-budget";
import {
  readAndDecodeEnviHeaderFileStreamingChunks,
  type ChunkedOpenedImageReadApi,
} from "@/lib/image/read-envi-through-chunked-protocol";
import type { BusyEntryHandle } from "@/state/busy-state-context";

// CT-239: opens are gated against the renderer's ArrayBuffer pool. The cost
// proxy is the file size on disk (exact for uncompressed band TIFFs and ENVI
// binaries, a floor for compressed formats); the ENVI streaming path re-checks
// with the exact sidecar byte count once the header names it.
export interface OpenAllocationBudgetOptions {
  readonly remainingRasterBudgetBytes?: number;
}

export type RunOpenImagesDialogResult =
  | { readonly kind: "canceled" }
  // CT-220: the single-file fast path returns the METADATA only; the caller reads and
  // decodes it via readAndDecodeSingleOpenedImageFile so decode progress can drive a
  // busy entry on the destination viewport instead of the app-wide read modal.
  | { readonly kind: "single-file"; readonly metadata: ToolboxOpenImagesDialogFileMetadataEntry }
  | { readonly kind: "review"; readonly proposal: OpenedFilesGroupingProposal };

interface RunOpenImagesDialogOptions extends OpenAllocationBudgetOptions {
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
  assertOpenedFilesFitMemoryBudget(dialogResult.files, options);
  return readAllFilesAndProposeGroups(dialogResult.files, options.readPhaseBusyHandle);
}

function assertOpenedFilesFitMemoryBudget(
  files: ReadonlyArray<ToolboxOpenImagesDialogFileMetadataEntry>,
  options: OpenAllocationBudgetOptions,
): void {
  if (options.remainingRasterBudgetBytes === undefined) return;
  const totalFileBytes = files.reduce((sum, file) => sum + file.fileSizeBytes, 0);
  assertAllocationFitsRemainingBudget(
    totalFileBytes,
    options.remainingRasterBudgetBytes,
    OPEN_IMAGES_MEMORY_REFUSAL_MESSAGE,
  );
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
  budgetOptions: OpenAllocationBudgetOptions = {},
): Promise<OpenedFileForGrouping> {
  // CT-231: an ENVI header streams its binary sibling chunk-by-chunk into the
  // decoder; the whole-binary reassembly path below never sees it.
  if (looksLikeEnviHeaderFileName(metadata.fileName)) {
    return readAndDecodeEnviHeaderFileStreamingChunks(
      buildChunkedOpenedImageReadApiFromToolboxBridge(),
      metadata,
      onDecodeProgress,
      budgetOptions,
    );
  }
  assertSingleOpenedFileFitsMemoryBudget(metadata, budgetOptions);
  const entry = await window.toolboxApi.readOpenedImageFile(metadata);
  const decoded = await tryDecodeOpenedImageEntry(entry, onDecodeProgress);
  return buildOpenedFileForGroupingFromEntry(entry, decoded);
}

function assertSingleOpenedFileFitsMemoryBudget(
  metadata: ToolboxOpenImagesDialogFileMetadataEntry,
  budgetOptions: OpenAllocationBudgetOptions,
): void {
  if (budgetOptions.remainingRasterBudgetBytes === undefined) return;
  assertAllocationFitsRemainingBudget(
    metadata.fileSizeBytes,
    budgetOptions.remainingRasterBudgetBytes,
    buildOpenSingleImageMemoryRefusalMessage(metadata.fileName),
  );
}

// CT-234: single-file consumers (re-import, reference pick) want a decoded
// source, not a grouping row; a decode failure becomes a thrown Error so their
// dialog-driven flows surface it as a toast.
export type DecodedOpenedImageFile = OpenedFileForGrouping & {
  readonly source: NonNullable<OpenedFileForGrouping["source"]>;
};

export async function readAndDecodeSingleOpenedImageFileOrThrow(
  metadata: ToolboxOpenImagesDialogFileMetadataEntry,
  onDecodeProgress?: UnitProgressCallback,
  budgetOptions: OpenAllocationBudgetOptions = {},
): Promise<DecodedOpenedImageFile> {
  const entry = await readAndDecodeSingleOpenedImageFile(metadata, onDecodeProgress, budgetOptions);
  if (entry.source === null) {
    throw new Error(entry.decodeError ?? `Could not decode ${metadata.fileName}`);
  }
  return { ...entry, source: entry.source };
}

function buildChunkedOpenedImageReadApiFromToolboxBridge(): ChunkedOpenedImageReadApi {
  return {
    begin: (request) => window.toolboxApi.beginOpenedImageChunkedRead(request),
    readChunk: (request) => window.toolboxApi.readOpenedImageChunk(request),
    finish: (request) => window.toolboxApi.finishOpenedImageChunkedRead(request),
    abort: (request) => window.toolboxApi.abortOpenedImageChunkedRead(request),
  };
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
      { fileName: entry.fileName, bytes: entry.bytes, filePath: entry.filePath },
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

// CT-232: the grouping entry deliberately omits entry.bytes so the raw file
// buffer becomes collectable as soon as this entry's decode completes; identity
// and re-import key off contentHash and filePath instead.
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
  };
}
