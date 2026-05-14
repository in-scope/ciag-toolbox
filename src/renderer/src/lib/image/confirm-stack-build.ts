import {
  buildStackEntryValidationStatesInDisplayOrder,
  isValidationStateExcludedFromStack,
} from "@/lib/image/compute-stack-row-validation";
import { stackSingleBandRastersIntoMultiBandRaster } from "@/lib/image/stack-rasters";
import type { DecodedStackEntry } from "@/lib/image/open-image-stack-types";
import type { RasterImage } from "@/lib/image/raster-image";
import type { BusyEntryHandle } from "@/state/busy-state-context";

export interface ConfirmedStackBuildResult {
  readonly raster: RasterImage;
  readonly suggestedFileName: string;
}

export async function buildConfirmedStackFromOrderedEntriesWithProgress(
  orderedEntries: ReadonlyArray<DecodedStackEntry>,
  busyHandle: BusyEntryHandle,
): Promise<ConfirmedStackBuildResult> {
  const includedEntries = filterOrderedEntriesToValidOnes(orderedEntries);
  requireAtLeastTwoIncludedEntries(includedEntries);
  await reportStackProgressIncrementallyOverIncludedEntries(includedEntries, busyHandle);
  const raster = stackSingleBandRastersIntoMultiBandRaster(
    includedEntries.map(convertDecodedEntryToStackable),
  );
  return { raster, suggestedFileName: pickStackSuggestedFileName(includedEntries) };
}

function filterOrderedEntriesToValidOnes(
  orderedEntries: ReadonlyArray<DecodedStackEntry>,
): ReadonlyArray<DecodedStackEntry> {
  const states = buildStackEntryValidationStatesInDisplayOrder(orderedEntries);
  return orderedEntries.filter((_, index) => {
    const state = states[index];
    return state !== undefined && !isValidationStateExcludedFromStack(state);
  });
}

function requireAtLeastTwoIncludedEntries(
  includedEntries: ReadonlyArray<DecodedStackEntry>,
): void {
  if (includedEntries.length < 2) {
    throw new Error("Stack needs at least two compatible single-page TIFFs");
  }
}

async function reportStackProgressIncrementallyOverIncludedEntries(
  includedEntries: ReadonlyArray<DecodedStackEntry>,
  busyHandle: BusyEntryHandle,
): Promise<void> {
  const total = includedEntries.length;
  for (let i = 0; i < total; i++) {
    busyHandle.update({
      label: `Stacking band ${i + 1} of ${total}...`,
      progress: (i + 1) / total,
    });
    await yieldOnceSoBusyOverlayCanPaint();
  }
}

function yieldOnceSoBusyOverlayCanPaint(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function convertDecodedEntryToStackable(
  entry: DecodedStackEntry,
): { raster: RasterImage; bandLabel: string; wavelength: number | null } {
  if (!entry.raster) {
    throw new Error(`Internal: entry ${entry.fileName} has no decoded raster`);
  }
  return {
    raster: entry.raster,
    bandLabel: entry.differentiatingSubstring || entry.fileName,
    wavelength: entry.wavelength,
  };
}

function pickStackSuggestedFileName(
  includedEntries: ReadonlyArray<DecodedStackEntry>,
): string {
  const first = includedEntries[0];
  if (!first) return "stack.tif";
  return `${stripTiffExtensionFromFileName(first.fileName)}-stack-${includedEntries.length}.tif`;
}

function stripTiffExtensionFromFileName(fileName: string): string {
  return fileName.replace(/\.(tif|tiff)$/i, "");
}
