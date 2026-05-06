import {
  buildDraftProjectFileFromSnapshot,
  type SaveableProjectSnapshot,
} from "./serialize-project";

export interface SaveProjectFlowInput {
  readonly snapshot: SaveableProjectSnapshot;
  readonly currentProjectFilePath: string | null;
  readonly saveAs: boolean;
}

export type SaveProjectFlowResult =
  | { canceled: true }
  | { canceled: false; filePath: string };

export async function runSaveProjectFlowThroughMainProcess(
  input: SaveProjectFlowInput,
): Promise<SaveProjectFlowResult> {
  const draft = buildDraftProjectFileFromSnapshot(input.snapshot);
  return window.toolboxApi.saveProjectDialog({
    draft,
    currentProjectFilePath: input.currentProjectFilePath,
    saveAs: input.saveAs,
  });
}
