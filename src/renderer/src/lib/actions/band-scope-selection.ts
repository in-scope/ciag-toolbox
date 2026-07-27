import {
  formatBandNumbersAsRangeText,
  parseBandRangeText,
} from "@/lib/image/parse-band-range";
import type { RasterImage } from "@/lib/image/raster-image";

import {
  FULL_CUBE_SCOPE,
  readBandRangeTextOrEmpty,
  readCubeScopeChoiceOrDefault,
  type CubeScopeChoice,
  type ParameterValuesById,
  type ResolvedCubeScopeSelection,
} from "./parameter-schema";

// Shared resolution for the locked "Full stack | Band-wise" scope control when
// it means "which bands does this operation touch" (CT-203 spatial filter,
// CT-204 denoise, CT-205 percentile clip; Normalize and Standardize share it
// too). Full stack selects every band; Band-wise selects the entered bands,
// and an EMPTY band field selects every band as well (CT-251) - there is no
// current-band fallback. The source band count is captured at Apply time as a
// hidden parameter (injectSourceBandCountForBandWiseLabels) so the applied
// label can describe an empty-field apply as the full range, because the label
// formatter runs without access to the raster.

export interface CubeScopeParameterIds {
  readonly scopeParameterId: string;
  readonly bandRangeParameterId: string;
  readonly bandCountParameterId: string;
}

export function injectSourceBandCountForBandWiseLabels(
  ids: CubeScopeParameterIds,
  rawParameterValues: ParameterValuesById,
  sourceRaster: RasterImage | null | undefined,
): ParameterValuesById {
  if (!sourceRaster) return rawParameterValues;
  return Object.freeze({
    ...rawParameterValues,
    [ids.bandCountParameterId]: sourceRaster.bandCount,
  });
}

export function resolveScopedBandIndexSet(
  ids: CubeScopeParameterIds,
  parameterValues: ParameterValuesById,
  bandCount: number,
): ReadonlySet<number> {
  if (readScopeChoice(ids, parameterValues) === FULL_CUBE_SCOPE) {
    return new Set(listEveryBandIndex(bandCount));
  }
  return new Set(resolveBandWiseScopedIndexes(ids, parameterValues, bandCount));
}

export function resolveCubeScopeSelectionFromParameters(
  ids: CubeScopeParameterIds,
  parameterValues: ParameterValuesById,
  bandCount: number,
): ResolvedCubeScopeSelection {
  if (readScopeChoice(ids, parameterValues) === FULL_CUBE_SCOPE) return { scope: "full-cube" };
  return {
    scope: "band-wise",
    bandIndexes: resolveBandWiseScopedIndexes(ids, parameterValues, bandCount),
  };
}

export function describeCubeScopeForAppliedLabel(
  ids: CubeScopeParameterIds,
  parameterValues: ParameterValuesById,
): string {
  if (readScopeChoice(ids, parameterValues) === FULL_CUBE_SCOPE) return "full stack";
  return `band-wise: ${describeBandWiseSelectionForLabel(ids, parameterValues)}`;
}

function resolveBandWiseScopedIndexes(
  ids: CubeScopeParameterIds,
  parameterValues: ParameterValuesById,
  bandCount: number,
): number[] {
  const text = readBandRangeTextOrEmpty(parameterValues[ids.bandRangeParameterId]);
  if (text.trim() === "") return listEveryBandIndex(bandCount);
  const parsed = parseBandRangeText(text, bandCount);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.bandNumbers.map((bandNumber) => bandNumber - 1);
}

function listEveryBandIndex(bandCount: number): number[] {
  return Array.from({ length: bandCount }, (_unused, index) => index);
}

function readScopeChoice(
  ids: CubeScopeParameterIds,
  parameterValues: ParameterValuesById,
): CubeScopeChoice {
  return readCubeScopeChoiceOrDefault(
    parameterValues[ids.scopeParameterId] ?? FULL_CUBE_SCOPE,
    FULL_CUBE_SCOPE,
  );
}

function describeBandWiseSelectionForLabel(
  ids: CubeScopeParameterIds,
  parameterValues: ParameterValuesById,
): string {
  const text = readBandRangeTextOrEmpty(parameterValues[ids.bandRangeParameterId]);
  if (text.trim() === "") return describeEveryBandForLabel(ids, parameterValues);
  const parsed = parseBandRangeText(text, Number.MAX_SAFE_INTEGER);
  return `bands ${parsed.ok ? formatBandNumbersAsRangeText(parsed.bandNumbers) : text.trim()}`;
}

function describeEveryBandForLabel(
  ids: CubeScopeParameterIds,
  parameterValues: ParameterValuesById,
): string {
  const bandCount = parameterValues[ids.bandCountParameterId];
  if (typeof bandCount !== "number" || !Number.isInteger(bandCount) || bandCount < 1) {
    return "all bands";
  }
  const everyBandNumber = Array.from({ length: bandCount }, (_unused, index) => index + 1);
  return `bands ${formatBandNumbersAsRangeText(everyBandNumber)}`;
}
