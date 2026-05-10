import { decodeImageBytesToViewportSource } from "@/lib/image/decode-image-bytes";
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

export async function runOpenProjectFlowThroughMainProcess(): Promise<OpenProjectFlowResult> {
  const dialogResult = await window.toolboxApi.openProjectBundleDialog();
  if (dialogResult.canceled) return { canceled: true };
  const project = parseProjectBytesAsProjectFileOrThrow(dialogResult.bytes);
  const opened = await readAllViewportAssetsForProject(dialogResult.projectFilePath, project);
  return { canceled: false, opened };
}

function parseProjectBytesAsProjectFileOrThrow(bytes: Uint8Array): ProjectFile {
  const text = new TextDecoder().decode(bytes);
  return parseProjectFileFromJsonString(text);
}

async function readAllViewportAssetsForProject(
  projectFilePath: string,
  project: ProjectFile,
): Promise<OpenedProject> {
  const resolved: OpenedProjectViewportSnapshot[] = [];
  for (const entry of project.viewports) {
    resolved.push(await readSingleViewportAssetOrThrow(projectFilePath, entry));
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
    source: decoded,
    originalFilePath: result.absolutePath,
    fileSizeBytes: result.bytes.length,
    entry,
  };
}
