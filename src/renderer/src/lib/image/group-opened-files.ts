import { parseStackBandOrderSuggestion } from "@/lib/image/parse-stack-band-order";
import type { ViewportImageSource } from "@/lib/webgl/texture";

import { classifyDecodedViewportSourceForOpenImagesFlow } from "./classify-opened-raster";

// CT-231: an ENVI header's binary sibling streams through the chunked decoder
// and is never held as bytes; rows carry its SIZE (for display) and file name.
// CT-232: no raw file bytes are retained AT ALL once decode completes - identity
// and re-import work from contentHash and filePath, so steady-state memory after
// an open is one cube, not cube plus file.
export interface OpenedFileForGrouping {
  readonly fileName: string;
  readonly filePath: string;
  readonly fileSizeBytes: number;
  readonly mtimeMs: number;
  readonly source: ViewportImageSource | null;
  readonly decodeError: string | null;
  readonly contentHash: string;
  readonly sidecarFileName?: string;
  readonly sidecarSizeBytes?: number;
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
  readonly sidecarSizeBytes?: number;
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
    id: "image-1",
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
    ...(file.sidecarSizeBytes !== undefined ? { sidecarSizeBytes: file.sidecarSizeBytes } : {}),
    ...(file.sidecarFileName ? { sidecarFileName: file.sidecarFileName } : {}),
  };
}

function buildSingleImageGroupFromFile(
  file: OpenedFileForGrouping,
  index: number,
): OpenedFilesGroup {
  return buildSingleImageGroupWithId(`single-${index + 1}-${file.fileName}`, file);
}

// CT-252: "Open bands separately" physically splits a multi-row group into one
// single-image group per row, in the same order, each shaped exactly like the
// groups built for files that arrive isolated (buildSingleImageGroupFromFile).
export function splitGroupRowsIntoSingleImageGroups(
  group: OpenedFilesGroup,
): ReadonlyArray<OpenedFilesGroup> {
  return group.rows.map((row, index) =>
    buildSingleImageGroupWithId(`${group.id}-split-${index + 1}-${row.fileName}`, row),
  );
}

// CT-264: a split remembers the pre-split group so "Recombine into one stack"
// can restore it exactly (same rows, same order, mode stack).
export interface SplitGroupRecoveryRecord {
  readonly originalGroup: OpenedFilesGroup;
  readonly splitGroupIds: ReadonlyArray<string>;
}

export interface SplitGroupsWithRecoveryRecord {
  readonly splitGroups: ReadonlyArray<OpenedFilesGroup>;
  readonly recoveryRecord: SplitGroupRecoveryRecord;
}

export function splitGroupRowsIntoSingleImageGroupsWithRecoveryRecord(
  group: OpenedFilesGroup,
): SplitGroupsWithRecoveryRecord {
  const splitGroups = splitGroupRowsIntoSingleImageGroups(group);
  return {
    splitGroups,
    recoveryRecord: {
      originalGroup: group,
      splitGroupIds: splitGroups.map((splitGroup) => splitGroup.id),
    },
  };
}

export function canRecombineSplitGroupsIntoOriginal(
  groups: ReadonlyArray<OpenedFilesGroup>,
  record: SplitGroupRecoveryRecord,
): boolean {
  if (record.splitGroupIds.length !== record.originalGroup.rows.length) return false;
  return record.splitGroupIds.every((splitGroupId, index) =>
    splitGroupStillHoldsItsOriginalRow(
      groups.find((group) => group.id === splitGroupId),
      record.originalGroup.rows[index],
    ),
  );
}

function splitGroupStillHoldsItsOriginalRow(
  group: OpenedFilesGroup | undefined,
  originalRow: GroupedOpenedFileRow | undefined,
): boolean {
  if (group === undefined || originalRow === undefined) return false;
  if (group.mode !== "singles") return false;
  if (group.rows.length !== 1) return false;
  return group.rows[0]!.contentHash === originalRow.contentHash;
}

// The restored group takes the FIRST split group's position; the remaining
// split groups are removed. Generic over the group shape so the review modal
// can run it over its view models without losing per-model state.
export function replaceSplitGroupsWithRestoredGroup<GroupShape extends { readonly id: string }>(
  groups: ReadonlyArray<GroupShape>,
  record: SplitGroupRecoveryRecord,
  restoredGroup: GroupShape,
): ReadonlyArray<GroupShape> {
  const splitIds = new Set(record.splitGroupIds);
  return groups.flatMap((group) => {
    if (!splitIds.has(group.id)) return [group];
    return group.id === record.splitGroupIds[0] ? [restoredGroup] : [];
  });
}

export function recombineSplitGroupsIntoOriginal(
  groups: ReadonlyArray<OpenedFilesGroup>,
  record: SplitGroupRecoveryRecord,
): ReadonlyArray<OpenedFilesGroup> {
  return replaceSplitGroupsWithRestoredGroup(groups, record, record.originalGroup);
}

function buildSingleImageGroupWithId(
  id: string,
  file: OpenedFileForGrouping,
): OpenedFilesGroup {
  return {
    id,
    mode: "singles",
    rows: [buildIsolatedSingleImageRowFromFile(file)],
    hadConfidentWavelengthParse: false,
  };
}

function buildIsolatedSingleImageRowFromFile(file: OpenedFileForGrouping): GroupedOpenedFileRow {
  return {
    fileName: file.fileName,
    filePath: file.filePath,
    fileSizeBytes: file.fileSizeBytes,
    mtimeMs: file.mtimeMs,
    source: file.source,
    decodeError: file.decodeError,
    wavelength: null,
    differentiatingSubstring: file.fileName,
    contentHash: file.contentHash,
    ...(file.sidecarSizeBytes !== undefined ? { sidecarSizeBytes: file.sidecarSizeBytes } : {}),
    ...(file.sidecarFileName ? { sidecarFileName: file.sidecarFileName } : {}),
  };
}
