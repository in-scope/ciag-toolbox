const MIN_PLAUSIBLE_WAVELENGTH_NM = 200;
const MAX_PLAUSIBLE_WAVELENGTH_NM = 2500;
const WAVELENGTH_DIGIT_PATTERN = /\d{3,4}/g;

export interface StackBandOrderSuggestion {
  readonly suggestedRowOrder: ReadonlyArray<string>;
  readonly parsedWavelengthByFileName: ReadonlyMap<string, number>;
  readonly differentiatingSubstringByFileName: ReadonlyMap<string, string>;
  readonly hadConfidentWavelengthParse: boolean;
}

export function parseStackBandOrderSuggestion(
  fileNames: ReadonlyArray<string>,
): StackBandOrderSuggestion {
  if (fileNames.length === 0) return emptyStackBandOrderSuggestion();
  const commonPrefix = findLongestCommonPrefixAcross(fileNames);
  const commonSuffix = findLongestCommonSuffixAcross(fileNames, commonPrefix.length);
  const differentiating = buildDifferentiatingSubstringMap(fileNames, commonPrefix, commonSuffix);
  const wavelengths = parseUniqueInRangeWavelengthsOrNull(fileNames, differentiating);
  return assembleBandOrderSuggestion(fileNames, differentiating, wavelengths);
}

function emptyStackBandOrderSuggestion(): StackBandOrderSuggestion {
  return {
    suggestedRowOrder: [],
    parsedWavelengthByFileName: new Map(),
    differentiatingSubstringByFileName: new Map(),
    hadConfidentWavelengthParse: false,
  };
}

function assembleBandOrderSuggestion(
  fileNames: ReadonlyArray<string>,
  differentiating: ReadonlyMap<string, string>,
  wavelengths: ReadonlyMap<string, number> | null,
): StackBandOrderSuggestion {
  const confident = wavelengths !== null;
  const wavelengthMap = wavelengths ?? new Map<string, number>();
  return {
    suggestedRowOrder: pickRowOrderByWavelengthOrAlphabetical(fileNames, wavelengthMap, confident),
    parsedWavelengthByFileName: wavelengthMap,
    differentiatingSubstringByFileName: differentiating,
    hadConfidentWavelengthParse: confident,
  };
}

function pickRowOrderByWavelengthOrAlphabetical(
  fileNames: ReadonlyArray<string>,
  wavelengths: ReadonlyMap<string, number>,
  confident: boolean,
): ReadonlyArray<string> {
  if (confident) return sortFileNamesByWavelengthAscending(fileNames, wavelengths);
  return sortFileNamesAlphabetically(fileNames);
}

function sortFileNamesByWavelengthAscending(
  fileNames: ReadonlyArray<string>,
  wavelengths: ReadonlyMap<string, number>,
): ReadonlyArray<string> {
  return [...fileNames].sort((a, b) => (wavelengths.get(a) ?? 0) - (wavelengths.get(b) ?? 0));
}

function sortFileNamesAlphabetically(fileNames: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...fileNames].sort((a, b) => a.localeCompare(b));
}

function findLongestCommonPrefixAcross(fileNames: ReadonlyArray<string>): string {
  if (fileNames.length === 0) return "";
  const [first, ...rest] = fileNames;
  if (first === undefined) return "";
  let prefixLength = first.length;
  for (const name of rest) {
    prefixLength = countMatchingLeadingCharacters(first, name, prefixLength);
  }
  return first.slice(0, prefixLength);
}

function countMatchingLeadingCharacters(
  first: string,
  other: string,
  maxLength: number,
): number {
  const limit = Math.min(maxLength, other.length);
  let count = 0;
  while (count < limit && first[count] === other[count]) count += 1;
  return count;
}

function findLongestCommonSuffixAcross(
  fileNames: ReadonlyArray<string>,
  reservedPrefixLength: number,
): string {
  if (fileNames.length === 0) return "";
  const [first, ...rest] = fileNames;
  if (first === undefined) return "";
  const maxSuffixForFirst = first.length - reservedPrefixLength;
  let suffixLength = maxSuffixForFirst;
  for (const name of rest) {
    suffixLength = countMatchingTrailingCharacters(first, name, suffixLength, reservedPrefixLength);
  }
  return first.slice(first.length - suffixLength);
}

function countMatchingTrailingCharacters(
  first: string,
  other: string,
  maxSuffix: number,
  reservedPrefixForOther: number,
): number {
  const otherMaxSuffix = Math.max(0, other.length - reservedPrefixForOther);
  const limit = Math.min(maxSuffix, otherMaxSuffix);
  let count = 0;
  while (count < limit && first[first.length - 1 - count] === other[other.length - 1 - count]) {
    count += 1;
  }
  return count;
}

function buildDifferentiatingSubstringMap(
  fileNames: ReadonlyArray<string>,
  commonPrefix: string,
  commonSuffix: string,
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const name of fileNames) {
    map.set(name, extractDifferentiatingMiddle(name, commonPrefix, commonSuffix));
  }
  return map;
}

function extractDifferentiatingMiddle(
  fileName: string,
  commonPrefix: string,
  commonSuffix: string,
): string {
  const start = commonPrefix.length;
  const end = fileName.length - commonSuffix.length;
  if (end <= start) return fileName;
  return fileName.slice(start, end);
}

function parseUniqueInRangeWavelengthsOrNull(
  fileNames: ReadonlyArray<string>,
  differentiating: ReadonlyMap<string, string>,
): ReadonlyMap<string, number> | null {
  const wavelengths = new Map<string, number>();
  const seen = new Set<number>();
  for (const name of fileNames) {
    const parsed = parseSingleInRangeWavelengthOrNull(differentiating.get(name) ?? "");
    if (parsed === null || seen.has(parsed)) return null;
    wavelengths.set(name, parsed);
    seen.add(parsed);
  }
  return wavelengths;
}

function parseSingleInRangeWavelengthOrNull(differentiating: string): number | null {
  const matches = differentiating.match(WAVELENGTH_DIGIT_PATTERN);
  if (!matches || matches.length === 0) return null;
  const inRange = matches.map(Number).filter(isInPlausibleWavelengthRange);
  if (inRange.length !== 1) return null;
  return inRange[0] ?? null;
}

function isInPlausibleWavelengthRange(value: number): boolean {
  return value >= MIN_PLAUSIBLE_WAVELENGTH_NM && value <= MAX_PLAUSIBLE_WAVELENGTH_NM;
}
