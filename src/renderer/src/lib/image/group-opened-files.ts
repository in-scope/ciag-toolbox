import { parseStackBandOrderSuggestion } from "@/lib/image/parse-stack-band-order";
import type { ViewportImageSource } from "@/lib/webgl/texture";

import { classifyDecodedViewportSourceForOpenImagesFlow } from "./classify-opened-raster";

export interface OpenedFileForGrouping {
  readonly fileName: string;
  readonly filePath: string;
  readonly fileSizeBytes: number;
  readonly mtimeMs: number;
  readonly source: ViewportImageSource | null;
  readonly decodeError: string | null;
  readonly contentHash: string;
  readonly sidecarFileName?: string;
  readonly sidecarBytes?: Uint8Array;
  readonly bytes: Uint8Array;
}

export interface GroupedOpenedFileRow {
  readonly fileName: string;
  readonly filePath: string;
  readonly fileSizeBytes: number;
  readonly mtimeMs: number;
  readonly source: ViewportImageSource | null;
  readonly decodeError: string | null;
  readonly wavelength: number | null;
  readonly differentiatingSubstring: string;
  readonly contentHash: string;
  readonly sidecarFileName?: string;
  readonly sidecarBytes?: Uint8Array;
  readonly bytes: Uint8Array;
}

export type OpenedFilesGroupMode = "stack" | "singles";

export interface OpenedFilesGroup {
  readonly id: string;
  readonly mode: OpenedFilesGroupMode;
  readonly rows: ReadonlyArray<GroupedOpenedFileRow>;
  readonly hadConfidentWavelengthParse: boolean;
}

export interface OpenedFilesGroupingProposal {
  readonly groups: ReadonlyArray<OpenedFilesGroup>;
}

export function proposeGroupsForOpenedFiles(
  files: ReadonlyArray<OpenedFileForGrouping>,
): OpenedFilesGroupingProposal {
  const partitioned = partitionFilesIntoStackableAndIsolated(files);
  const stackGroup = buildStackGroupOrNull(partitioned.stackable);
  const singles = partitioned.isolated.map(buildSingleImageGroupFromFile);
  const groups = stackGroup ? [stackGroup, ...singles] : singles;
  return { groups };
}

interface PartitionedOpenedFiles {
  readonly stackable: ReadonlyArray<OpenedFileForGrouping>;
  readonly isolated: ReadonlyArray<OpenedFileForGrouping>;
}

function partitionFilesIntoStackableAndIsolated(
  files: ReadonlyArray<OpenedFileForGrouping>,
): PartitionedOpenedFiles {
  const stackable: OpenedFileForGrouping[] = [];
  const isolated: OpenedFileForGrouping[] = [];
  for (const file of files) {
    if (isStackablePlaneFile(file)) stackable.push(file);
    else isolated.push(file);
  }
  return { stackable, isolated };
}

function isStackablePlaneFile(file: OpenedFileForGrouping): boolean {
  if (file.decodeError !== null) return false;
  if (file.source === null) return false;
  const classification = classifyDecodedViewportSourceForOpenImagesFlow(file.source);
  return classification.kind === "stackable-plane";
}

function buildStackGroupOrNull(
  stackable: ReadonlyArray<OpenedFileForGrouping>,
): OpenedFilesGroup | null {
  if (stackable.length === 0) return null;
  const suggestion = parseStackBandOrderSuggestion(stackable.map((file) => file.fileName));
  const rows = buildOrderedRowsFromStackableAndSuggestion(stackable, suggestion);
  return {
    id: "stack-1",
    mode: stackable.length >= 2 ? "stack" : "singles",
    rows,
    hadConfidentWavelengthParse: suggestion.hadConfidentWavelengthParse,
  };
}

function buildOrderedRowsFromStackableAndSuggestion(
  stackable: ReadonlyArray<OpenedFileForGrouping>,
  suggestion: ReturnType<typeof parseStackBandOrderSuggestion>,
): ReadonlyArray<GroupedOpenedFileRow> {
  const byName = new Map(stackable.map((file) => [file.fileName, file]));
  const ordered: GroupedOpenedFileRow[] = [];
  for (const fileName of suggestion.suggestedRowOrder) {
    const file = byName.get(fileName);
    if (file) ordered.push(buildRowFromFileAndSuggestion(file, suggestion));
  }
  if (ordered.length === stackable.length) return ordered;
  return stackable.map((file) => buildRowFromFileAndSuggestion(file, suggestion));
}

function buildRowFromFileAndSuggestion(
  file: OpenedFileForGrouping,
  suggestion: ReturnType<typeof parseStackBandOrderSuggestion>,
): GroupedOpenedFileRow {
  return {
    fileName: file.fileName,
    filePath: file.filePath,
    fileSizeBytes: file.fileSizeBytes,
    mtimeMs: file.mtimeMs,
    source: file.source,
    decodeError: file.decodeError,
    wavelength: suggestion.parsedWavelengthByFileName.get(file.fileName) ?? null,
    differentiatingSubstring:
      suggestion.differentiatingSubstringByFileName.get(file.fileName) ?? file.fileName,
    contentHash: file.contentHash,
    bytes: file.bytes,
    ...(file.sidecarBytes ? { sidecarBytes: file.sidecarBytes } : {}),
    ...(file.sidecarFileName ? { sidecarFileName: file.sidecarFileName } : {}),
  };
}

function buildSingleImageGroupFromFile(
  file: OpenedFileForGrouping,
  index: number,
): OpenedFilesGroup {
  return {
    id: `single-${index + 1}-${file.fileName}`,
    mode: "singles",
    rows: [
      {
        fileName: file.fileName,
        filePath: file.filePath,
        fileSizeBytes: file.fileSizeBytes,
        mtimeMs: file.mtimeMs,
        source: file.source,
        decodeError: file.decodeError,
        wavelength: null,
        differentiatingSubstring: file.fileName,
        contentHash: file.contentHash,
        bytes: file.bytes,
        ...(file.sidecarBytes ? { sidecarBytes: file.sidecarBytes } : {}),
        ...(file.sidecarFileName ? { sidecarFileName: file.sidecarFileName } : {}),
      },
    ],
    hadConfidentWavelengthParse: false,
  };
}
