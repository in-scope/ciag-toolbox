import { BAND_RANGE_SYNTAX_EXAMPLES, parseBandRangeText } from "./parse-band-range";

// CT-283: the Subset Bands editor's typed index list. The field complements the
// checkbox list, so an EMPTY field is neutral (no error, no selection change)
// instead of reusing the parser's enter-at-least-one-band error.
export const SUBSET_BANDS_RANGE_FIELD_HINT = `Use commas to list bands and dashes for ranges (e.g. ${BAND_RANGE_SYNTAX_EXAMPLES})`;

export type SubsetBandRangeFieldOutcome =
  | { readonly kind: "neutral" }
  | { readonly kind: "invalid"; readonly error: string }
  | { readonly kind: "selection"; readonly keptBandIndexes: ReadonlySet<number> };

export function deriveKeptBandSelectionFromTypedRangeText(
  text: string,
  bandCount: number,
): SubsetBandRangeFieldOutcome {
  if (text.trim().length === 0) return { kind: "neutral" };
  const parsed = parseBandRangeText(text, bandCount);
  if (!parsed.ok) return { kind: "invalid", error: parsed.error };
  return { kind: "selection", keptBandIndexes: buildKeptBandIndexSet(parsed.bandNumbers) };
}

export function describeTypedRangeFieldErrorOrNull(text: string, bandCount: number): string | null {
  const outcome = deriveKeptBandSelectionFromTypedRangeText(text, bandCount);
  return outcome.kind === "invalid" ? outcome.error : null;
}

function buildKeptBandIndexSet(bandNumbers: ReadonlyArray<number>): ReadonlySet<number> {
  return new Set(bandNumbers.map((bandNumber) => bandNumber - 1));
}
