import {
  formatBandNumbersAsRangeText,
  parseBandRangeText,
} from "@/lib/image/parse-band-range";

import {
  FULL_CUBE_SCOPE,
  readBandRangeTextOrEmpty,
  readCubeScopeChoiceOrDefault,
  type CubeScopeChoice,
  type ParameterValuesById,
} from "./parameter-schema";
import type { ViewportRenderingState } from "./viewport-action";

// Shared resolution for the locked "Full stack | Band-wise" scope control when
// it means "which bands does this operation touch" (CT-203 spatial filter,
// CT-204 denoise): Full stack selects every band; Band-wise selects the
// entered bands and falls back to the band the user is looking at when the
// range is empty. The viewed band is captured at Apply time as a hidden
// parameter (injectSelectedBandAsBandWiseDefault) because the transform runs
// without access to the rendering state.

export interface CubeScopeParameterIds {
  readonly scopeParameterId: string;
  readonly bandRangeParameterId: string;
  readonly targetBandParameterId: string;
}

export function injectSelectedBandAsBandWiseDefault(
  ids: CubeScopeParameterIds,
  rawParameterValues: ParameterValuesById,
  sourceRenderingState: ViewportRenderingState,
): ParameterValuesById {
  return Object.freeze({
    ...rawParameterValues,
    [ids.targetBandParameterId]: sourceRenderingState.selectedBandIndex,
  });
}

export function resolveScopedBandIndexSet(
  ids: CubeScopeParameterIds,
  parameterValues: ParameterValuesById,
  bandCount: number,
): ReadonlySet<number> {
  if (readScopeChoice(ids, parameterValues) === FULL_CUBE_SCOPE) {
    return new Set(Array.from({ length: bandCount }, (_unused, index) => index));
  }
  return new Set(resolveBandWiseScopedIndexes(ids, parameterValues, bandCount));
}

export function describeCubeScopeForAppliedLabel(
  ids: CubeScopeParameterIds,
  parameterValues: ParameterValuesById,
): string {
  if (readScopeChoice(ids, parameterValues) === FULL_CUBE_SCOPE) return "full stack";
  return `band-wise: bands ${describeBandWiseBandSetForLabel(ids, parameterValues)}`;
}

function resolveBandWiseScopedIndexes(
  ids: CubeScopeParameterIds,
  parameterValues: ParameterValuesById,
  bandCount: number,
): ReadonlyArray<number> {
  const text = readBandRangeTextOrEmpty(parameterValues[ids.bandRangeParameterId]);
  if (text.trim() === "") return [readTargetBandIndexOrZero(ids, parameterValues)];
  const parsed = parseBandRangeText(text, bandCount);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.bandNumbers.map((bandNumber) => bandNumber - 1);
}

function readTargetBandIndexOrZero(
  ids: CubeScopeParameterIds,
  parameterValues: ParameterValuesById,
): number {
  const raw = parameterValues[ids.targetBandParameterId];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  return Math.max(0, Math.round(raw));
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

function describeBandWiseBandSetForLabel(
  ids: CubeScopeParameterIds,
  parameterValues: ParameterValuesById,
): string {
  const text = readBandRangeTextOrEmpty(parameterValues[ids.bandRangeParameterId]);
  if (text.trim() === "") return String(readTargetBandIndexOrZero(ids, parameterValues) + 1);
  const parsed = parseBandRangeText(text, Number.MAX_SAFE_INTEGER);
  return parsed.ok ? formatBandNumbersAsRangeText(parsed.bandNumbers) : text.trim();
}
