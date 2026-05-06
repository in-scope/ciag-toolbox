import { decodeImageBytesToViewportSource } from "@/lib/image/decode-image-bytes";
import type { ViewportImageSource } from "@/lib/webgl/texture";

import { parseProjectFileFromJsonString } from "./parse-project";
import type { ProjectFile, ProjectViewportEntry } from "./project-schema";

export interface OpenedProjectViewportSnapshot {
  readonly index: number;
  readonly fileName: string;
  readonly source: ViewportImageSource;
  readonly originalFilePath: string;
  readonly originalContentHash: string;
  readonly fileSizeBytes: number;
  readonly entry: ProjectViewportEntry;
}

export interface OpenedProjectUnresolvedViewport {
  readonly index: number;
  readonly fileName: string;
}

export interface OpenedProjectDivergedSource {
  readonly index: number;
  readonly fileName: string;
  readonly expectedHash: string;
  readonly actualHash: string;
}

export interface OpenedProject {
  readonly projectFilePath: string;
  readonly project: ProjectFile;
  readonly resolvedViewports: ReadonlyArray<OpenedProjectViewportSnapshot>;
  readonly unresolvedViewports: ReadonlyArray<OpenedProjectUnresolvedViewport>;
  readonly divergedViewports: ReadonlyArray<OpenedProjectDivergedSource>;
}

export type OpenProjectFlowResult =
  | { canceled: true }
  | { canceled: false; opened: OpenedProject };

export interface ConfirmDivergenceCallback {
  (diverged: ReadonlyArray<OpenedProjectDivergedSource>): Promise<boolean>;
}

export async function runOpenProjectFlowThroughMainProcess(
  confirmDivergence: ConfirmDivergenceCallback,
): Promise<OpenProjectFlowResult> {
  const dialogResult = await window.toolboxApi.openProjectDialog();
  if (dialogResult.canceled) return { canceled: true };
  const project = parseProjectBytesAsProjectFileOrThrow(dialogResult.bytes);
  const opened = await resolveAllViewportSourcesForProject(dialogResult.filePath, project);
  if (!(await passDivergenceConfirmationGate(opened, confirmDivergence))) {
    return { canceled: true };
  }
  return { canceled: false, opened };
}

function parseProjectBytesAsProjectFileOrThrow(bytes: Uint8Array): ProjectFile {
  const text = new TextDecoder().decode(bytes);
  return parseProjectFileFromJsonString(text);
}

async function passDivergenceConfirmationGate(
  opened: OpenedProject,
  confirmDivergence: ConfirmDivergenceCallback,
): Promise<boolean> {
  if (opened.divergedViewports.length === 0) return true;
  return confirmDivergence(opened.divergedViewports);
}

async function resolveAllViewportSourcesForProject(
  projectFilePath: string,
  project: ProjectFile,
): Promise<OpenedProject> {
  const accumulator: OpenProjectMutableAccumulator = {
    projectFilePath,
    project,
    resolved: [],
    unresolved: [],
    diverged: [],
  };
  for (const entry of project.viewports) {
    await resolveSingleViewportEntryIntoAccumulator(entry, accumulator);
  }
  return finalizeAccumulatorAsOpenedProject(accumulator);
}

interface OpenProjectMutableAccumulator {
  readonly projectFilePath: string;
  readonly project: ProjectFile;
  readonly resolved: OpenedProjectViewportSnapshot[];
  readonly unresolved: OpenedProjectUnresolvedViewport[];
  readonly diverged: OpenedProjectDivergedSource[];
}

async function resolveSingleViewportEntryIntoAccumulator(
  entry: ProjectViewportEntry,
  accumulator: OpenProjectMutableAccumulator,
): Promise<void> {
  const result = await resolveProjectViewportSourceWithFallbackToLocate(
    accumulator.projectFilePath,
    entry,
  );
  if (!result) {
    accumulator.unresolved.push({ index: entry.index, fileName: entry.source.fileName });
    return;
  }
  await placeResolvedSourceIntoAccumulator(entry, result, accumulator);
}

interface ResolvedProjectSourceLoaded {
  readonly absolutePath: string;
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly sidecarBytes?: Uint8Array;
  readonly contentHash: string;
}

async function resolveProjectViewportSourceWithFallbackToLocate(
  projectFilePath: string,
  entry: ProjectViewportEntry,
): Promise<ResolvedProjectSourceLoaded | null> {
  const direct = await window.toolboxApi.resolveProjectSource({
    projectFilePath,
    relativePath: entry.source.relativePath,
  });
  if (direct.kind === "found") return mapResolvedSourceToLoaded(direct);
  return promptUserToLocateMissingSource(entry);
}

function mapResolvedSourceToLoaded(
  source: Extract<ToolboxResolveProjectSourceResult, { kind: "found" }>,
): ResolvedProjectSourceLoaded {
  return {
    absolutePath: source.absolutePath,
    fileName: source.fileName,
    bytes: source.bytes,
    sidecarBytes: source.sidecar?.bytes,
    contentHash: source.contentHash,
  };
}

async function promptUserToLocateMissingSource(
  entry: ProjectViewportEntry,
): Promise<ResolvedProjectSourceLoaded | null> {
  const located = await window.toolboxApi.locateMissingProjectSource({
    originalFileName: entry.source.fileName,
    defaultDir: null,
  });
  if (located.kind === "canceled") return null;
  return {
    absolutePath: located.absolutePath,
    fileName: located.fileName,
    bytes: located.bytes,
    sidecarBytes: located.sidecar?.bytes,
    contentHash: located.contentHash,
  };
}

async function placeResolvedSourceIntoAccumulator(
  entry: ProjectViewportEntry,
  loaded: ResolvedProjectSourceLoaded,
  accumulator: OpenProjectMutableAccumulator,
): Promise<void> {
  const decoded = await decodeImageBytesToViewportSource({
    fileName: loaded.fileName,
    bytes: loaded.bytes,
    sidecarBytes: loaded.sidecarBytes,
  });
  collectDivergenceFromExpectedHash(entry, loaded.contentHash, accumulator);
  accumulator.resolved.push({
    index: entry.index,
    fileName: loaded.fileName,
    source: decoded,
    originalFilePath: loaded.absolutePath,
    originalContentHash: loaded.contentHash,
    fileSizeBytes: loaded.bytes.length,
    entry,
  });
}

function collectDivergenceFromExpectedHash(
  entry: ProjectViewportEntry,
  actualHash: string,
  accumulator: OpenProjectMutableAccumulator,
): void {
  if (actualHash === entry.source.contentHash) return;
  accumulator.diverged.push({
    index: entry.index,
    fileName: entry.source.fileName,
    expectedHash: entry.source.contentHash,
    actualHash,
  });
}

function finalizeAccumulatorAsOpenedProject(
  accumulator: OpenProjectMutableAccumulator,
): OpenedProject {
  return {
    projectFilePath: accumulator.projectFilePath,
    project: accumulator.project,
    resolvedViewports: accumulator.resolved,
    unresolvedViewports: accumulator.unresolved,
    divergedViewports: accumulator.diverged,
  };
}
