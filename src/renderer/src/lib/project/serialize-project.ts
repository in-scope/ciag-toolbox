import type { GridLayout } from "@/lib/grid/grid-layout";

import {
  IDENTITY_PROJECT_VIEWPORT_VIEW_TRANSFORM,
  PROJECT_FILE_FORMAT_VERSION,
  type ProjectOperationHistoryEntry,
  type ProjectViewportRenderingState,
} from "./project-schema";

export interface DraftProjectViewportSourceReference {
  readonly absolutePath: string;
  readonly contentHash: string;
  readonly fileName: string;
}

export interface DraftProjectViewportEntry {
  readonly index: number;
  readonly source: DraftProjectViewportSourceReference;
  readonly renderingState: ProjectViewportRenderingState;
  readonly operationHistory: ReadonlyArray<ProjectOperationHistoryEntry>;
}

export interface DraftProjectFile {
  readonly formatVersion: typeof PROJECT_FILE_FORMAT_VERSION;
  readonly gridLayout: GridLayout;
  readonly selectedViewportIndices: ReadonlyArray<number>;
  readonly viewports: ReadonlyArray<DraftProjectViewportEntry>;
}

export interface SaveableViewportSnapshot {
  readonly index: number;
  readonly originalFilePath: string;
  readonly originalContentHash: string;
  readonly fileName: string;
  readonly renderingState: ProjectViewportRenderingState;
  readonly operationHistory: ReadonlyArray<ProjectOperationHistoryEntry>;
}

export interface SaveableProjectSnapshot {
  readonly gridLayout: GridLayout;
  readonly selectedViewportIndices: ReadonlyArray<number>;
  readonly viewports: ReadonlyArray<SaveableViewportSnapshot>;
}

export function buildDraftProjectFileFromSnapshot(
  snapshot: SaveableProjectSnapshot,
): DraftProjectFile {
  return {
    formatVersion: PROJECT_FILE_FORMAT_VERSION,
    gridLayout: snapshot.gridLayout,
    selectedViewportIndices: [...snapshot.selectedViewportIndices].sort((a, b) => a - b),
    viewports: snapshot.viewports.map(buildDraftViewportEntry),
  };
}

function buildDraftViewportEntry(
  viewport: SaveableViewportSnapshot,
): DraftProjectViewportEntry {
  return {
    index: viewport.index,
    source: {
      absolutePath: viewport.originalFilePath,
      contentHash: viewport.originalContentHash,
      fileName: viewport.fileName,
    },
    renderingState: viewport.renderingState,
    operationHistory: viewport.operationHistory,
  };
}

export { IDENTITY_PROJECT_VIEWPORT_VIEW_TRANSFORM };
