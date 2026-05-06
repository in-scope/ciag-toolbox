import type { GridLayout } from "@/lib/grid/grid-layout";

export const PROJECT_FILE_FORMAT_VERSION = 1;
export const PROJECT_FILE_EXTENSION = "ctproj";

export interface ProjectViewportSourceReference {
  readonly relativePath: string;
  readonly contentHash: string;
  readonly fileName: string;
}

export interface ProjectViewportRenderingState {
  readonly normalizationEnabled: boolean;
  readonly selectedBandIndex: number;
  readonly lastAppliedOperationLabel: string | null;
}

export interface ProjectViewportViewTransform {
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
}

export interface ProjectViewportEntry {
  readonly index: number;
  readonly source: ProjectViewportSourceReference;
  readonly renderingState: ProjectViewportRenderingState;
  readonly viewTransform: ProjectViewportViewTransform;
  readonly operationHistory: ReadonlyArray<unknown>;
  readonly roi: null;
}

export interface ProjectFile {
  readonly formatVersion: typeof PROJECT_FILE_FORMAT_VERSION;
  readonly gridLayout: GridLayout;
  readonly selectedViewportIndices: ReadonlyArray<number>;
  readonly viewports: ReadonlyArray<ProjectViewportEntry>;
}

export const IDENTITY_PROJECT_VIEWPORT_VIEW_TRANSFORM: ProjectViewportViewTransform = {
  zoom: 1,
  panX: 0,
  panY: 0,
};
