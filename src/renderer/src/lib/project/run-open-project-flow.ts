import { decodeImageBytesToViewportSource } from "@/lib/image/decode-image-bytes";
import { restoreSourceColorInterpretation } from "@/lib/image/restore-source-color-interpretation";
import type { ViewportImageSource } from "@/lib/webgl/texture";

import { parseProjectFileFromJsonString } from "./parse-project";
import type { ProjectFile, ProjectViewportEntry } from "./project-schema";

export interface OpenedProjectViewportSnapshot {
  readonly index: number;
  readonly fileName: string;
  readonly source: ViewportImageSource;
  readonly originalFilePath: string;
  readonly fileSizeBytes: number;
  readonly entry: ProjectViewportEntry;
}

export interface OpenedProject {
  readonly projectFilePath: string;
  readonly project: ProjectFile;
  readonly resolvedViewports: ReadonlyArray<OpenedProjectViewportSnapshot>;
}

export type OpenProjectFlowResult =
  | { canceled: true }
  | { canceled: false; opened: OpenedProject };

export interface OpenProjectFlowProgressEvent {
  readonly readAssetCount: number;
  readonly totalAssetCount: number;
}

export interface OpenProjectFlowOptions {
  readonly onProgress?: (event: OpenProjectFlowProgressEvent) => void;
}

export async function runOpenProjectFlowThroughMainProcess(
  options: OpenProjectFlowOptions = {},
): Promise<OpenProjectFlowResult> {
  const dialogResult = await window.toolboxApi.openProjectBundleDialog();
  if (dialogResult.canceled) return { canceled: true };
  const project = parseProjectBytesAsProjectFileOrThrow(dialogResult.bytes);
  const opened = await readAllViewportAssetsForProject(
    dialogResult.projectFilePath,
    project,
    options.onProgress,
  );
  return { canceled: false, opened };
}

function parseProjectBytesAsProjectFileOrThrow(bytes: Uint8Array): ProjectFile {
  const text = new TextDecoder().decode(bytes);
  return parseProjectFileFromJsonString(text);
}

async function readAllViewportAssetsForProject(
  projectFilePath: string,
  project: ProjectFile,
  onProgress: OpenProjectFlowOptions["onProgress"],
): Promise<OpenedProject> {
  const totalAssetCount = project.viewports.length;
  onProgress?.({ readAssetCount: 0, totalAssetCount });
  const resolved: OpenedProjectViewportSnapshot[] = [];
  for (let viewportPosition = 0; viewportPosition < totalAssetCount; viewportPosition++) {
    const entry = project.viewports[viewportPosition]!;
    resolved.push(await readSingleViewportAssetOrThrow(projectFilePath, entry));
    onProgress?.({ readAssetCount: viewportPosition + 1, totalAssetCount });
  }
  return { projectFilePath, project, resolvedViewports: resolved };
}

async function readSingleViewportAssetOrThrow(
  projectFilePath: string,
  entry: ProjectViewportEntry,
): Promise<OpenedProjectViewportSnapshot> {
  const result = await window.toolboxApi.readProjectBundleAsset({
    projectFilePath,
    relativePath: entry.source.relativePath,
  });
  if (result.kind === "missing") {
    throw new Error(`Bundle asset "${entry.source.relativePath}" is missing or unreadable`);
  }
  const decoded = await decodeImageBytesToViewportSource({
    fileName: result.fileName,
    bytes: result.bytes,
    sidecarBytes: result.sidecar?.bytes,
  });
  return {
    index: entry.index,
    fileName: entry.source.fileName,
    source: restoreSourceColorInterpretation(decoded, entry.colorInterpretation),
    originalFilePath: result.absolutePath,
    fileSizeBytes: result.bytes.length,
    entry,
  };
}
