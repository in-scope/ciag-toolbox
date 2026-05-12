import { findStackedRasterMismatchOrNull } from "@/lib/image/stack-rasters";
import type { RasterImage } from "@/lib/image/raster-image";

import type {
  DecodedStackEntry,
  StackEntryValidationState,
} from "./open-image-stack-types";

export function buildStackEntryValidationStatesInDisplayOrder(
  orderedEntries: ReadonlyArray<DecodedStackEntry>,
): ReadonlyArray<StackEntryValidationState> {
  const baseline = pickFirstSinglePageBaselineRasterOrNull(orderedEntries);
  return orderedEntries.map((entry) => deriveValidationStateForEntry(entry, baseline));
}

function pickFirstSinglePageBaselineRasterOrNull(
  entries: ReadonlyArray<DecodedStackEntry>,
): RasterImage | null {
  for (const entry of entries) {
    if (entry.raster && entry.raster.bandCount === 1) return entry.raster;
  }
  return null;
}

function deriveValidationStateForEntry(
  entry: DecodedStackEntry,
  baseline: RasterImage | null,
): StackEntryValidationState {
  if (entry.decodeError !== null) {
    return { kind: "decode-failed", message: entry.decodeError };
  }
  if (entry.raster === null) {
    return { kind: "decode-failed", message: "Failed to decode TIFF" };
  }
  if (entry.raster.bandCount > 1) {
    return buildMultiPageValidationState(entry.raster.bandCount);
  }
  return validateAgainstBaselineOrReturnValid(entry.raster, baseline);
}

function buildMultiPageValidationState(pageCount: number): StackEntryValidationState {
  return { kind: "multi-page", pageCount };
}

function validateAgainstBaselineOrReturnValid(
  candidate: RasterImage,
  baseline: RasterImage | null,
): StackEntryValidationState {
  if (baseline === null) return { kind: "valid" };
  const mismatch = findStackedRasterMismatchOrNull(baseline, candidate);
  if (mismatch === null) return { kind: "valid" };
  return {
    kind: "property-mismatch",
    propertyName: mismatch.propertyName,
    message: `${mismatch.propertyName} ${String(mismatch.observedValue)} differs from baseline ${String(mismatch.baselineValue)}`,
  };
}

export function isValidationStateExcludedFromStack(state: StackEntryValidationState): boolean {
  return state.kind !== "valid";
}

export function describeMultiPageValidationError(pageCount: number): string {
  return `Stacking requires single-page TIFFs; this file has ${pageCount} pages. Use File > Open Image to load it as its own multi-band raster.`;
}
