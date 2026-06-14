export type BandRangeParseResult =
  | { readonly ok: true; readonly bandNumbers: number[] }
  | { readonly ok: false; readonly error: string };

interface BandRangeSpanEndpoints {
  readonly start: number;
  readonly end: number;
}

export function parseBandRangeText(text: string, bandCount: number): BandRangeParseResult {
  const tokens = splitBandRangeIntoTokens(text);
  if (tokens.length === 0) return failBandRange("Enter at least one band (e.g. 1,3,5 or 1-5,10).");
  const collected: number[] = [];
  for (const token of tokens) {
    const tokenResult = parseSingleBandRangeToken(token, bandCount);
    if (!tokenResult.ok) return tokenResult;
    collected.push(...tokenResult.bandNumbers);
  }
  return { ok: true, bandNumbers: sortAndDedupeBandNumbersAscending(collected) };
}

export function describeBandRangeErrorOrNull(text: string, bandCount: number | null): string | null {
  if (bandCount === null) return null;
  const result = parseBandRangeText(text, bandCount);
  return result.ok ? null : result.error;
}

export function formatBandNumbersAsRangeText(bandNumbers: ReadonlyArray<number>): string {
  const runs = groupBandNumbersIntoConsecutiveRuns(sortAndDedupeBandNumbersAscending(bandNumbers));
  return runs.map(formatBandNumberRun).join(",");
}

function splitBandRangeIntoTokens(text: string): string[] {
  return text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parseSingleBandRangeToken(token: string, bandCount: number): BandRangeParseResult {
  if (token.includes("-")) return parseBandRangeSpanToken(token, bandCount);
  return parseSingleBandNumberToken(token, bandCount);
}

function parseSingleBandNumberToken(token: string, bandCount: number): BandRangeParseResult {
  const value = parsePositiveIntegerOrNull(token);
  if (value === null) return failBandRange(`"${token}" is not a valid band number.`);
  if (!isBandNumberWithinCount(value, bandCount)) return failBandRange(outOfRangeMessage(value, bandCount));
  return { ok: true, bandNumbers: [value] };
}

function parseBandRangeSpanToken(token: string, bandCount: number): BandRangeParseResult {
  const endpoints = readBandRangeSpanEndpointsOrNull(token);
  if (endpoints === null) return failBandRange(`"${token}" is not a valid band range.`);
  return buildBandRangeSpanResult(token, endpoints, bandCount);
}

function readBandRangeSpanEndpointsOrNull(token: string): BandRangeSpanEndpoints | null {
  const parts = token.split("-").map((part) => part.trim());
  if (parts.length !== 2) return null;
  const start = parsePositiveIntegerOrNull(parts[0] ?? "");
  const end = parsePositiveIntegerOrNull(parts[1] ?? "");
  if (start === null || end === null) return null;
  return { start, end };
}

function buildBandRangeSpanResult(
  token: string,
  endpoints: BandRangeSpanEndpoints,
  bandCount: number,
): BandRangeParseResult {
  if (endpoints.start > endpoints.end) return failBandRange(`Range "${token}" must go from low to high.`);
  if (!isBandNumberWithinCount(endpoints.start, bandCount)) {
    return failBandRange(outOfRangeMessage(endpoints.start, bandCount));
  }
  if (!isBandNumberWithinCount(endpoints.end, bandCount)) {
    return failBandRange(outOfRangeMessage(endpoints.end, bandCount));
  }
  return { ok: true, bandNumbers: listIntegersInclusive(endpoints.start, endpoints.end) };
}

function parsePositiveIntegerOrNull(text: string): number | null {
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function isBandNumberWithinCount(value: number, bandCount: number): boolean {
  return value >= 1 && value <= bandCount;
}

function outOfRangeMessage(value: number, bandCount: number): string {
  return `Band ${value} is out of range (1-${bandCount}).`;
}

function listIntegersInclusive(start: number, end: number): number[] {
  const values: number[] = [];
  for (let value = start; value <= end; value += 1) values.push(value);
  return values;
}

function sortAndDedupeBandNumbersAscending(values: ReadonlyArray<number>): number[] {
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

function groupBandNumbersIntoConsecutiveRuns(sorted: ReadonlyArray<number>): BandRangeSpanEndpoints[] {
  const runs: Array<{ start: number; end: number }> = [];
  for (const value of sorted) {
    const last = runs[runs.length - 1];
    if (last && value === last.end + 1) last.end = value;
    else runs.push({ start: value, end: value });
  }
  return runs;
}

function formatBandNumberRun(run: BandRangeSpanEndpoints): string {
  return run.start === run.end ? String(run.start) : `${run.start}-${run.end}`;
}

function failBandRange(error: string): BandRangeParseResult {
  return { ok: false, error };
}
