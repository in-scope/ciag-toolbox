export type EnviInterleave = "bsq" | "bil" | "bip";

export interface EnviHeader {
  readonly samples: number;
  readonly lines: number;
  readonly bands: number;
  readonly dataType: number;
  readonly byteOrder: 0 | 1;
  readonly interleave: EnviInterleave;
  readonly headerOffset: number;
  readonly bandNames?: ReadonlyArray<string>;
  readonly wavelengths?: ReadonlyArray<number>;
}

const ENVI_MAGIC_LINE = "ENVI";

export function parseEnviHeaderText(text: string): EnviHeader {
  rejectMissingEnviMagicLine(text);
  const fields = collectEnviFieldsFromHeaderText(text);
  return buildEnviHeaderFromFields(fields);
}

function rejectMissingEnviMagicLine(text: string): void {
  const firstLine = readFirstNonEmptyLineOrEmpty(text);
  if (firstLine.toUpperCase() !== ENVI_MAGIC_LINE) {
    throw new Error("ENVI header must start with the ENVI magic line");
  }
}

function readFirstNonEmptyLineOrEmpty(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return "";
}

type EnviFieldMap = ReadonlyMap<string, string>;

function collectEnviFieldsFromHeaderText(text: string): EnviFieldMap {
  const segments = splitEnviHeaderIntoLogicalLines(text);
  const fields = new Map<string, string>();
  for (const segment of segments) {
    storeFieldFromSegmentIfPresent(segment, fields);
  }
  return fields;
}

function splitEnviHeaderIntoLogicalLines(text: string): ReadonlyArray<string> {
  const collapsed = collapseBraceSpansIntoSingleLines(text);
  return collapsed.split(/\r?\n/);
}

function collapseBraceSpansIntoSingleLines(text: string): string {
  return text.replace(/\{([\s\S]*?)\}/g, (_match, body: string) => {
    const flattened = body.replace(/\s+/g, " ").trim();
    return `{ ${flattened} }`;
  });
}

function storeFieldFromSegmentIfPresent(
  segment: string,
  fields: Map<string, string>,
): void {
  const equalsIndex = segment.indexOf("=");
  if (equalsIndex < 0) return;
  const key = segment.slice(0, equalsIndex).trim().toLowerCase();
  const value = segment.slice(equalsIndex + 1).trim();
  if (key.length === 0) return;
  fields.set(key, value);
}

function buildEnviHeaderFromFields(fields: EnviFieldMap): EnviHeader {
  return {
    samples: readPositiveIntegerFieldOrThrow(fields, "samples"),
    lines: readPositiveIntegerFieldOrThrow(fields, "lines"),
    bands: readPositiveIntegerFieldOrThrow(fields, "bands"),
    dataType: readPositiveIntegerFieldOrThrow(fields, "data type"),
    byteOrder: readByteOrderFieldOrDefault(fields),
    interleave: readInterleaveFieldOrThrow(fields),
    headerOffset: readNonNegativeIntegerFieldOrZero(fields, "header offset"),
    bandNames: readBraceListFieldOrUndefined(fields, "band names"),
    wavelengths: readNumericBraceListFieldOrUndefined(fields, "wavelength"),
  };
}

function readPositiveIntegerFieldOrThrow(
  fields: EnviFieldMap,
  key: string,
): number {
  const value = readIntegerFieldOrThrow(fields, key);
  if (value <= 0) {
    throw new Error(`ENVI header field "${key}" must be a positive integer`);
  }
  return value;
}

function readNonNegativeIntegerFieldOrZero(
  fields: EnviFieldMap,
  key: string,
): number {
  const raw = fields.get(key);
  if (raw === undefined) return 0;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`ENVI header field "${key}" must be a non-negative integer`);
  }
  return value;
}

function readIntegerFieldOrThrow(fields: EnviFieldMap, key: string): number {
  const raw = fields.get(key);
  if (raw === undefined) {
    throw new Error(`ENVI header is missing required field "${key}"`);
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    throw new Error(`ENVI header field "${key}" is not a valid integer`);
  }
  return value;
}

function readByteOrderFieldOrDefault(fields: EnviFieldMap): 0 | 1 {
  const raw = fields.get("byte order");
  if (raw === undefined) return 0;
  const value = Number.parseInt(raw, 10);
  if (value === 0 || value === 1) return value;
  throw new Error('ENVI header field "byte order" must be 0 or 1');
}

function readInterleaveFieldOrThrow(fields: EnviFieldMap): EnviInterleave {
  const raw = fields.get("interleave");
  if (raw === undefined) {
    throw new Error('ENVI header is missing required field "interleave"');
  }
  const lower = raw.toLowerCase();
  if (lower === "bsq" || lower === "bil" || lower === "bip") return lower;
  throw new Error(`ENVI header field "interleave" must be one of bsq, bil, bip (got "${raw}")`);
}

function readBraceListFieldOrUndefined(
  fields: EnviFieldMap,
  key: string,
): ReadonlyArray<string> | undefined {
  const raw = fields.get(key);
  if (raw === undefined) return undefined;
  return parseBraceWrappedCommaSeparatedList(raw);
}

function readNumericBraceListFieldOrUndefined(
  fields: EnviFieldMap,
  key: string,
): ReadonlyArray<number> | undefined {
  const list = readBraceListFieldOrUndefined(fields, key);
  if (!list) return undefined;
  return list.map((entry) => parseFloatOrThrow(entry, key));
}

function parseFloatOrThrow(text: string, key: string): number {
  const value = Number.parseFloat(text);
  if (!Number.isFinite(value)) {
    throw new Error(`ENVI header field "${key}" contains a non-numeric entry "${text}"`);
  }
  return value;
}

function parseBraceWrappedCommaSeparatedList(raw: string): ReadonlyArray<string> {
  const stripped = stripWrappingBracesOrThrow(raw);
  if (stripped.length === 0) return [];
  return stripped.split(",").map((entry) => entry.trim());
}

function stripWrappingBracesOrThrow(raw: string): string {
  if (!raw.startsWith("{") || !raw.endsWith("}")) {
    throw new Error('ENVI brace-wrapped field must begin with "{" and end with "}"');
  }
  return raw.slice(1, -1).trim();
}
