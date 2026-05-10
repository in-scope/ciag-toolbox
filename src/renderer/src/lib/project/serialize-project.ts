import type { GridLayout } from "@/lib/grid/grid-layout";
import {
  encodeBakedBundleAssetForRasterSource,
  type BundleAssetBakedSidecar,
} from "@/lib/image/encode-bundle-asset";
import type { ViewportImageSource } from "@/lib/webgl/texture";

import {
  IDENTITY_PROJECT_VIEWPORT_VIEW_TRANSFORM,
  PROJECT_FILE_FORMAT_VERSION,
  type ProjectOperationHistoryEntry,
  type ProjectViewportRenderingState,
} from "./project-schema";

export interface DraftBundleBakedAsset {
  readonly kind: "baked";
  readonly bytes: Uint8Array;
  readonly extension: string;
  readonly sidecar?: BundleAssetBakedSidecar;
}

export interface DraftBundleExternalAsset {
  readonly kind: "external";
  readonly absolutePath: string;
  readonly extension: string;
}

export type DraftBundleAsset = DraftBundleBakedAsset | DraftBundleExternalAsset;

export interface DraftBundleViewportEntry {
  readonly index: number;
  readonly fileName: string;
  readonly asset: DraftBundleAsset;
  readonly renderingState: ProjectViewportRenderingState;
  readonly operationHistory: ReadonlyArray<ProjectOperationHistoryEntry>;
}

export interface DraftBundleFile {
  readonly formatVersion: typeof PROJECT_FILE_FORMAT_VERSION;
  readonly gridLayout: GridLayout;
  readonly selectedViewportIndices: ReadonlyArray<number>;
  readonly viewports: ReadonlyArray<DraftBundleViewportEntry>;
}

export interface SaveableViewportSnapshot {
  readonly index: number;
  readonly fileName: string;
  readonly source: ViewportImageSource;
  readonly originalFilePath: string | null;
  readonly renderingState: ProjectViewportRenderingState;
  readonly operationHistory: ReadonlyArray<ProjectOperationHistoryEntry>;
}

export interface SaveableProjectSnapshot {
  readonly gridLayout: GridLayout;
  readonly selectedViewportIndices: ReadonlyArray<number>;
  readonly viewports: ReadonlyArray<SaveableViewportSnapshot>;
}

export function buildDraftBundleFromSnapshot(
  snapshot: SaveableProjectSnapshot,
): DraftBundleFile {
  return {
    formatVersion: PROJECT_FILE_FORMAT_VERSION,
    gridLayout: snapshot.gridLayout,
    selectedViewportIndices: [...snapshot.selectedViewportIndices].sort((a, b) => a - b),
    viewports: snapshot.viewports.map(buildDraftBundleViewportEntryOrThrow),
  };
}

function buildDraftBundleViewportEntryOrThrow(
  viewport: SaveableViewportSnapshot,
): DraftBundleViewportEntry {
  return {
    index: viewport.index,
    fileName: viewport.fileName,
    asset: buildDraftBundleAssetForViewportOrThrow(viewport),
    renderingState: viewport.renderingState,
    operationHistory: viewport.operationHistory,
  };
}

function buildDraftBundleAssetForViewportOrThrow(
  viewport: SaveableViewportSnapshot,
): DraftBundleAsset {
  if (viewport.source.kind === "raster") {
    return encodeBakedBundleAssetForRasterSource(viewport.source.raster);
  }
  return buildExternalAssetForBrowserSourceOrThrow(viewport);
}

function buildExternalAssetForBrowserSourceOrThrow(
  viewport: SaveableViewportSnapshot,
): DraftBundleExternalAsset {
  if (!viewport.originalFilePath) {
    throw new Error(
      `Viewport "${viewport.fileName}" has no on-disk source to pack into the bundle`,
    );
  }
  return {
    kind: "external",
    absolutePath: viewport.originalFilePath,
    extension: extractFileExtensionWithoutLeadingDot(viewport.fileName),
  };
}

function extractFileExtensionWithoutLeadingDot(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) return "";
  return fileName.slice(dotIndex + 1);
}

export { IDENTITY_PROJECT_VIEWPORT_VIEW_TRANSFORM };
