import { loadTiffAsRaster } from "@/lib/image/load-tiff";
import { parseStackBandOrderSuggestion } from "@/lib/image/parse-stack-band-order";
import type {
  DecodedStackEntry,
  PendingOpenImageStack,
} from "@/lib/image/open-image-stack-types";
import type { RasterImage } from "@/lib/image/raster-image";
import type { BusyEntryHandle } from "@/state/busy-state-context";

interface DialogFileEntry {
  readonly fileName: string;
  readonly filePath: string;
  readonly bytes: Uint8Array;
  readonly fileSizeBytes: number;
  readonly mtimeMs: number;
}

export type RunOpenImageStackDialogResult =
  | { readonly kind: "canceled" }
  | { readonly kind: "too-few-files" }
  | { readonly kind: "ready"; readonly pending: PendingOpenImageStack };

interface RunOpenImageStackOptions {
  readonly readPhaseBusyHandle: BusyEntryHandle;
  readonly subscribeReadProgress: SubscribeToStackReadProgress;
}

type SubscribeToStackReadProgress = (
  listener: (event: ToolboxOpenImageStackProgressEvent) => void,
) => () => void;

export async function runOpenImageStackDialogPhase(
  options: RunOpenImageStackOptions,
): Promise<RunOpenImageStackDialogResult> {
  const unsubscribe = options.subscribeReadProgress((event) =>
    updateReadProgressOnBusyHandle(event, options.readPhaseBusyHandle),
  );
  try {
    return await invokeStackDialogAndBuildPendingResult(options.readPhaseBusyHandle);
  } finally {
    unsubscribe();
  }
}

function updateReadProgressOnBusyHandle(
  event: ToolboxOpenImageStackProgressEvent,
  handle: BusyEntryHandle,
): void {
  handle.update({
    label: `Reading file ${event.fileIndex} of ${event.totalCount}...`,
    progress: event.fileIndex / Math.max(1, event.totalCount),
  });
}

async function invokeStackDialogAndBuildPendingResult(
  handle: BusyEntryHandle,
): Promise<RunOpenImageStackDialogResult> {
  const dialogResult = await window.toolboxApi.openImageStackDialog();
  if (dialogResult.canceled) return { kind: "canceled" };
  if (dialogResult.files.length < 2) return { kind: "too-few-files" };
  const decoded = await decodeAllStackFilesWithProgress(dialogResult.files, handle);
  return { kind: "ready", pending: buildPendingOpenImageStackFromDecoded(decoded) };
}

async function decodeAllStackFilesWithProgress(
  files: ReadonlyArray<DialogFileEntry>,
  handle: BusyEntryHandle,
): Promise<ReadonlyArray<DecodedStackEntry>> {
  const decoded: DecodedStackEntry[] = [];
  for (let index = 0; index < files.length; index++) {
    updateDecodeProgressOnBusyHandle(index, files.length, handle);
    const file = files[index];
    if (file === undefined) continue;
    decoded.push(await decodeSingleStackFile(file));
  }
  return decoded;
}

function updateDecodeProgressOnBusyHandle(
  zeroBasedIndex: number,
  totalCount: number,
  handle: BusyEntryHandle,
): void {
  handle.update({
    label: `Decoding TIFF ${zeroBasedIndex + 1} of ${totalCount}...`,
    progress: zeroBasedIndex / Math.max(1, totalCount),
  });
}

async function decodeSingleStackFile(file: DialogFileEntry): Promise<DecodedStackEntry> {
  const decoded = await tryLoadRasterFromBytes(file.bytes);
  return {
    fileName: file.fileName,
    filePath: file.filePath,
    fileSizeBytes: file.fileSizeBytes,
    mtimeMs: file.mtimeMs,
    raster: decoded.raster,
    decodeError: decoded.errorMessage,
    wavelength: null,
    differentiatingSubstring: file.fileName,
  };
}

async function tryLoadRasterFromBytes(
  bytes: Uint8Array,
): Promise<{ raster: RasterImage | null; errorMessage: string | null }> {
  try {
    return { raster: await loadTiffAsRaster(bytes), errorMessage: null };
  } catch (error) {
    return { raster: null, errorMessage: convertUnknownErrorToMessage(error) };
  }
}

function convertUnknownErrorToMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function buildPendingOpenImageStackFromDecoded(
  decoded: ReadonlyArray<DecodedStackEntry>,
): PendingOpenImageStack {
  const suggestion = parseStackBandOrderSuggestion(decoded.map((entry) => entry.fileName));
  const enriched = decoded.map((entry) => attachParsedMetadataToDecoded(entry, suggestion));
  const reordered = reorderEntriesBySuggestedOrder(enriched, suggestion.suggestedRowOrder);
  return {
    entries: reordered,
    hadConfidentWavelengthParse: suggestion.hadConfidentWavelengthParse,
  };
}

function attachParsedMetadataToDecoded(
  entry: DecodedStackEntry,
  suggestion: ReturnType<typeof parseStackBandOrderSuggestion>,
): DecodedStackEntry {
  return {
    ...entry,
    wavelength: suggestion.parsedWavelengthByFileName.get(entry.fileName) ?? null,
    differentiatingSubstring:
      suggestion.differentiatingSubstringByFileName.get(entry.fileName) ?? entry.fileName,
  };
}

function reorderEntriesBySuggestedOrder(
  entries: ReadonlyArray<DecodedStackEntry>,
  suggestedOrder: ReadonlyArray<string>,
): ReadonlyArray<DecodedStackEntry> {
  const byName = new Map(entries.map((entry) => [entry.fileName, entry]));
  const ordered: DecodedStackEntry[] = [];
  for (const fileName of suggestedOrder) {
    const entry = byName.get(fileName);
    if (entry) ordered.push(entry);
  }
  return ordered.length === entries.length ? ordered : entries;
}
