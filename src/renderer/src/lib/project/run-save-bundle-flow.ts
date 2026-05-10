import {
  buildDraftBundleFromSnapshot,
  type SaveableProjectSnapshot,
} from "./serialize-project";

export interface SaveBundleFlowInput {
  readonly snapshot: SaveableProjectSnapshot;
  readonly currentProjectFilePath: string | null;
  readonly saveAs: boolean;
}

export type SaveBundleFlowResult =
  | { canceled: true }
  | { canceled: false; filePath: string };

export async function runSaveProjectBundleFlowThroughMainProcess(
  input: SaveBundleFlowInput,
): Promise<SaveBundleFlowResult> {
  const draft = buildDraftBundleFromSnapshot(input.snapshot);
  return window.toolboxApi.saveProjectBundleDialog({
    draft,
    currentProjectFilePath: input.currentProjectFilePath,
    saveAs: input.saveAs,
  });
}
