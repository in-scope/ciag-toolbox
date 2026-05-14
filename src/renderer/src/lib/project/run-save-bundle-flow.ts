import { PROJECT_FILE_FORMAT_VERSION } from "./project-schema";
import {
  buildDraftBundleViewportEntryOrThrow,
  type DraftBundleFile,
  type DraftBundleViewportEntry,
  type SaveableProjectSnapshot,
} from "./serialize-project";

export interface SaveBundleFlowProgressEvent {
  readonly bakedAssetCount: number;
  readonly totalAssetCount: number;
}

export interface SaveBundleFlowInput {
  readonly snapshot: SaveableProjectSnapshot;
  readonly currentProjectFilePath: string | null;
  readonly saveAs: boolean;
  readonly onProgress?: (event: SaveBundleFlowProgressEvent) => void;
}

export type SaveBundleFlowResult =
  | { canceled: true }
  | { canceled: false; filePath: string };

export async function runSaveProjectBundleFlowThroughMainProcess(
  input: SaveBundleFlowInput,
): Promise<SaveBundleFlowResult> {
  const draft = await buildDraftBundleWithIncrementalProgressReporting(
    input.snapshot,
    input.onProgress,
  );
  return window.toolboxApi.saveProjectBundleDialog({
    draft,
    currentProjectFilePath: input.currentProjectFilePath,
    saveAs: input.saveAs,
  });
}

async function buildDraftBundleWithIncrementalProgressReporting(
  snapshot: SaveableProjectSnapshot,
  onProgress: SaveBundleFlowInput["onProgress"],
): Promise<DraftBundleFile> {
  const viewports = await bakeViewportEntriesWithProgress(snapshot, onProgress);
  return {
    formatVersion: PROJECT_FILE_FORMAT_VERSION,
    gridLayout: snapshot.gridLayout,
    selectedViewportIndices: [...snapshot.selectedViewportIndices].sort((a, b) => a - b),
    viewports,
  };
}

async function bakeViewportEntriesWithProgress(
  snapshot: SaveableProjectSnapshot,
  onProgress: SaveBundleFlowInput["onProgress"],
): Promise<ReadonlyArray<DraftBundleViewportEntry>> {
  const totalAssetCount = snapshot.viewports.length;
  onProgress?.({ bakedAssetCount: 0, totalAssetCount });
  const baked: DraftBundleViewportEntry[] = [];
  for (let viewportPosition = 0; viewportPosition < totalAssetCount; viewportPosition++) {
    baked.push(buildDraftBundleViewportEntryOrThrow(snapshot.viewports[viewportPosition]!));
    onProgress?.({ bakedAssetCount: viewportPosition + 1, totalAssetCount });
    await yieldToMicrotaskQueue();
  }
  return baked;
}

function yieldToMicrotaskQueue(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
