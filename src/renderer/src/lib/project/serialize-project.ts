import type { GridLayout } from "@/lib/grid/grid-layout";
import {
  encodeBakedBundleAssetForRasterSource,
  type BundleAssetBakedSidecar,
} from "@/lib/image/encode-bundle-asset";
import type { RasterColorInterpretation } from "@/lib/image/raster-image";
import { shouldRenderRasterAsRgbComposite } from "@/lib/image/raster-color-interpretation";
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
  readonly colorInterpretation?: RasterColorInterpretation;
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

export function buildDraftBundleViewportEntryOrThrow(
  viewport: SaveableViewportSnapshot,
): DraftBundleViewportEntry {
  return {
    index: viewport.index,
    fileName: viewport.fileName,
    asset: buildDraftBundleAssetForViewportOrThrow(viewport),
    renderingState: viewport.renderingState,
    operationHistory: viewport.operationHistory,
    colorInterpretation: readPersistableColorInterpretationFromSource(viewport.source),
  };
}

// Persist the colour flag only for a genuine RGB composite (exactly three
// display channels). A scientific multi-band stack leaves it undefined, so the
// manifest stays free of the tag and the stack reopens with per-band viewing.
function readPersistableColorInterpretationFromSource(
  source: ViewportImageSource,
): RasterColorInterpretation | undefined {
  if (source.kind !== "raster") return undefined;
  return shouldRenderRasterAsRgbComposite(source.raster) ? "rgb" : undefined;
}

function buildDraftBundleAssetForViewportOrThrow(
  viewport: SaveableViewportSnapshot,
): DraftBundleAsset {
  if (canStreamUnmodifiedSourceFromDisk(viewport)) {
    return buildExternalAssetReferencingOriginalFile(viewport);
  }
  if (viewport.source.kind === "raster") {
    return encodeBakedBundleAssetForRasterSource(viewport.source.raster);
  }
  return buildExternalAssetForBrowserSourceOrThrow(viewport);
}

// Re-encoding (baking) a raster source is a CPU-bound, multi-second operation
// for large cubes that blocks the renderer thread. The save flow uses this to
// decide whether to let the busy indicator paint before that synchronous work
// begins (CT-072), so a save that only references unmodified on-disk files
// stays as fast and flash-free as before.
export function saveableSnapshotRequiresRasterRebake(
  snapshot: SaveableProjectSnapshot,
): boolean {
  return snapshot.viewports.some(viewportRequiresRasterRebake);
}

function viewportRequiresRasterRebake(viewport: SaveableViewportSnapshot): boolean {
  if (canStreamUnmodifiedSourceFromDisk(viewport)) return false;
  return viewport.source.kind === "raster";
}

// Re-encoding a raster into the bundle materialises a second full-size copy in
// the renderer and clones it again across IPC, which crashes the renderer for
// large ENVI cubes (CT-061). When the source is still the untouched on-disk
// file, reference it instead so the main process streams it straight from disk.
function canStreamUnmodifiedSourceFromDisk(
  viewport: SaveableViewportSnapshot,
): boolean {
  if (!viewport.originalFilePath) return false;
  return viewport.operationHistory.length === 0;
}

function buildExternalAssetReferencingOriginalFile(
  viewport: SaveableViewportSnapshot,
): DraftBundleExternalAsset {
  return {
    kind: "external",
    absolutePath: viewport.originalFilePath!,
    extension: extractFileExtensionWithoutLeadingDot(viewport.fileName),
  };
}

function buildExternalAssetForBrowserSourceOrThrow(
  viewport: SaveableViewportSnapshot,
): DraftBundleExternalAsset {
  if (!viewport.originalFilePath) {
    throw new Error(
      `Panel "${viewport.fileName}" has no on-disk source to pack into the bundle`,
    );
  }
  return buildExternalAssetReferencingOriginalFile(viewport);
}

function extractFileExtensionWithoutLeadingDot(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) return "";
  return fileName.slice(dotIndex + 1);
}

export { IDENTITY_PROJECT_VIEWPORT_VIEW_TRANSFORM };
