import {
  buildDraftProjectFileFromSnapshot,
  type SaveableProjectSnapshot,
} from "./serialize-project";

export interface PackBundleFlowInput {
  readonly snapshot: SaveableProjectSnapshot;
  readonly currentProjectFilePath: string | null;
}

export type PackBundleFlowResult =
  | { canceled: true }
  | { canceled: false; filePath: string };

export async function runPackProjectBundleFlowThroughMainProcess(
  input: PackBundleFlowInput,
): Promise<PackBundleFlowResult> {
  const draft = buildDraftProjectFileFromSnapshot(input.snapshot);
  return window.toolboxApi.packProjectBundle({
    draft,
    currentProjectFilePath: input.currentProjectFilePath,
  });
}
