import { restoreSourceColorInterpretation } from "@/lib/image/restore-source-color-interpretation";
import { readAndDecodeSingleOpenedImageFileOrThrow } from "@/lib/image/run-open-images-flow";
import type { UnitProgressCallback } from "@/lib/image/unit-progress";
import type { MaskPanelState } from "@/lib/masks/mask-panel";
import type { ViewportImageSource } from "@/lib/webgl/texture";

import { parseProjectFileFromJsonString } from "./parse-project";
import type { ProjectFile, ProjectViewportEntry } from "./project-schema";
import { readMaskPanelStateForViewportEntry } from "./read-project-mask-assets";

// CT-236: bundle assets never cross IPC as whole byte payloads. Each viewport
// asset is resolved to file metadata by main and then read through the same
// chunked opened-image path as a normal open, so an ENVI asset streams its
// binary sidecar straight into the CT-231 chunk-fed decoder and a project
// holding a 10 GB stack reopens without any 2 GiB single-reply ceiling.

export interface OpenedProjectViewportSnapshot {
  readonly index: number;
  readonly fileName: string;
  readonly source: ViewportImageSource;
  readonly originalFilePath: string;
  readonly fileSizeBytes: number;
  readonly entry: ProjectViewportEntry;
  // CT-306: empty for a version 2 bundle and for any panel saved without masks.
  readonly masks: MaskPanelState;
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
  // 0..1 within the asset currently being read, so a single multi-gigabyte
  // asset still drives a moving progress bar.
  readonly currentAssetFraction: number;
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
  reportAssetProgress(onProgress, 0, totalAssetCount, 0);
  const resolved: OpenedProjectViewportSnapshot[] = [];
  for (let viewportPosition = 0; viewportPosition < totalAssetCount; viewportPosition++) {
    resolved.push(
      await readViewportAssetAtPositionReportingProgress(
        projectFilePath,
        project,
        { position: viewportPosition, totalAssetCount },
        onProgress,
      ),
    );
    reportAssetProgress(onProgress, viewportPosition + 1, totalAssetCount, 0);
  }
  return { projectFilePath, project, resolvedViewports: resolved };
}

function reportAssetProgress(
  onProgress: OpenProjectFlowOptions["onProgress"],
  readAssetCount: number,
  totalAssetCount: number,
  currentAssetFraction: number,
): void {
  onProgress?.({ readAssetCount, totalAssetCount, currentAssetFraction });
}

async function readViewportAssetAtPositionReportingProgress(
  projectFilePath: string,
  project: ProjectFile,
  place: { position: number; totalAssetCount: number },
  onProgress: OpenProjectFlowOptions["onProgress"],
): Promise<OpenedProjectViewportSnapshot> {
  const entry = project.viewports[place.position]!;
  return readSingleViewportAssetOrThrow(projectFilePath, entry, (fraction) =>
    reportAssetProgress(onProgress, place.position, place.totalAssetCount, fraction),
  );
}

async function readSingleViewportAssetOrThrow(
  projectFilePath: string,
  entry: ProjectViewportEntry,
  onDecodeProgress: UnitProgressCallback,
): Promise<OpenedProjectViewportSnapshot> {
  const resolved = await window.toolboxApi.resolveProjectBundleAsset({
    projectFilePath,
    relativePath: entry.source.relativePath,
  });
  if (resolved.kind === "missing") {
    throw new Error(`Bundle asset "${entry.source.relativePath}" is missing or unreadable`);
  }
  const decoded = await readAndDecodeSingleOpenedImageFileOrThrow(resolved.file, onDecodeProgress);
  return buildViewportSnapshotFromDecodedAsset(entry, resolved.file, decoded.source, {
    masks: await readMaskPanelStateForViewportEntry(projectFilePath, entry),
  });
}

function buildViewportSnapshotFromDecodedAsset(
  entry: ProjectViewportEntry,
  file: ToolboxOpenImagesDialogFileMetadataEntry,
  source: ViewportImageSource,
  restored: { masks: MaskPanelState },
): OpenedProjectViewportSnapshot {
  return {
    index: entry.index,
    fileName: entry.source.fileName,
    source: restoreSourceColorInterpretation(source, entry.colorInterpretation),
    originalFilePath: file.filePath,
    fileSizeBytes: file.fileSizeBytes,
    entry,
    masks: restored.masks,
  };
}
