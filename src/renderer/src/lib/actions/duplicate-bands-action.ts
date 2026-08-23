import { CopyPlus } from "lucide-react";

import { mapKeptBandNumbersToCurrentPositions } from "@/lib/image/apply-band-keep";
import { duplicateRasterBands } from "@/lib/image/duplicate-bands";
import { formatBandNumbersAsRangeText } from "@/lib/image/parse-band-range";
import { coerceViewportSourceToRasterSource } from "@/lib/image/promote-source-to-raster";

import type { ParameterValuesById } from "./parameter-schema";
import {
  clearBandSubsetEditModeFromSource,
  clearBandSubsetStateAfterApply,
  type RegisteredViewportAction,
} from "./registered-actions";
import type { ViewportActionSourceTransform } from "./viewport-action";

// CT-301: the Subset Bands editor's "Duplicate" mode. Like Subset Bands' own
// "keep bands" mode, this action has NO menu entry - it lives entirely inside
// that editor and applies through the same duplicated-of-source/in-place flow
// (App's runApplyDuplicateBandsForViewport), so it shares the editor's
// band-count-changing state resets rather than reinventing them.

export const DUPLICATE_BANDS_ACTION_ID = "band-duplicate";
export const DUPLICATE_BANDS_PARAMETER_ID_BAND_NUMBERS = "duplicatedBandNumbers";

export const DUPLICATE_BANDS_ACTION: RegisteredViewportAction = {
  id: DUPLICATE_BANDS_ACTION_ID,
  label: "Duplicate Bands",
  icon: CopyPlus,
  successMessage: "Bands duplicated",
  appliedLabel: "Duplicate bands",
  formatAppliedLabel: formatDuplicateBandsAppliedLabel,
  apply: clearBandSubsetStateAfterApply,
  clearConsumedSourceStateAfterApply: clearBandSubsetEditModeFromSource,
  transformSource: createDuplicateBandsSourceTransform(),
};

function createDuplicateBandsSourceTransform(): ViewportActionSourceTransform {
  return (rawSource, parameterValues) => {
    const source = coerceViewportSourceToRasterSource(rawSource);
    const bandNumbers = readDuplicatedBandNumbersFromParameterValues(parameterValues);
    const bandIndexes = mapKeptBandNumbersToCurrentPositions(source.raster, bandNumbers);
    return { kind: "raster", raster: duplicateRasterBands(source.raster, bandIndexes) };
  };
}

export function buildDuplicateBandsParameterValuesFromBandNumbers(
  bandNumbersInOrder: ReadonlyArray<number>,
): ParameterValuesById {
  return Object.freeze({
    [DUPLICATE_BANDS_PARAMETER_ID_BAND_NUMBERS]: encodeDuplicatedBandNumbersAsString(bandNumbersInOrder),
  });
}

export function readDuplicatedBandNumbersFromParameterValues(
  parameterValues: ParameterValuesById,
): ReadonlyArray<number> {
  const raw = parameterValues[DUPLICATE_BANDS_PARAMETER_ID_BAND_NUMBERS];
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error("Duplicate Bands missing duplicatedBandNumbers parameter.");
  }
  return raw.split(",").map(parseSingleDuplicatedBandNumberOrThrow);
}

function encodeDuplicatedBandNumbersAsString(bandNumbersInOrder: ReadonlyArray<number>): string {
  return bandNumbersInOrder.join(",");
}

function parseSingleDuplicatedBandNumberOrThrow(token: string): number {
  const parsed = Number.parseInt(token.trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Duplicate Bands received invalid band number '${token}'.`);
  }
  return parsed;
}

function formatDuplicateBandsAppliedLabel(parameterValues: ParameterValuesById): string {
  const bandNumbers = readDuplicatedBandNumbersFromParameterValues(parameterValues);
  return `Duplicate bands (${formatBandNumbersAsRangeText(bandNumbers)})`;
}
