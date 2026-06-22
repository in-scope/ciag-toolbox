import { describeBandRangeErrorOrNull } from "@/lib/image/parse-band-range";

export interface ParameterSchemaBase {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

export interface NumberParameterSchema extends ParameterSchemaBase {
  readonly kind: "number";
  readonly defaultValue: number;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

export interface IntegerParameterSchema extends ParameterSchemaBase {
  readonly kind: "integer";
  readonly defaultValue: number;
  readonly min?: number;
  readonly max?: number;
}

export interface SliderParameterSchema extends ParameterSchemaBase {
  readonly kind: "slider";
  readonly defaultValue: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly valueSuffix?: string;
}

export interface EnumParameterSchema extends ParameterSchemaBase {
  readonly kind: "enum";
  readonly defaultValue: string;
  readonly options: ReadonlyArray<EnumParameterOption>;
}

export interface EnumParameterOption {
  readonly value: string;
  readonly label: string;
}

export interface BooleanParameterSchema extends ParameterSchemaBase {
  readonly kind: "boolean";
  readonly defaultValue: boolean;
}

export type CubeScopeChoice = "full-cube" | "band-wise";

export const FULL_CUBE_SCOPE: CubeScopeChoice = "full-cube";
export const BAND_WISE_SCOPE: CubeScopeChoice = "band-wise";

export interface CubeScopeParameterSchema extends ParameterSchemaBase {
  readonly kind: "cube-scope";
  readonly defaultValue: CubeScopeChoice;
  readonly bandRangeParameterId: string;
}

export interface RasterReferenceParameterSchema extends ParameterSchemaBase {
  readonly kind: "raster-reference";
  readonly optional: boolean;
  readonly defaultValue: string;
}

export const NO_RASTER_REFERENCE_SELECTED = "";

export interface BandNumberParameterSchema extends ParameterSchemaBase {
  readonly kind: "band-number";
  readonly defaultValue: number;
}

// CT-180: the primary control of every dimension-reduction transform. Its valid
// range and default both depend on the source band count (1..bandCount,
// defaulting to min(10, bandCount)), which is only known when the panel opens,
// so the field resolves and displays "X of N" from the live band count rather
// than from static schema bounds. resolveComponentCount is the shared clamp.
export interface ComponentCountParameterSchema extends ParameterSchemaBase {
  readonly kind: "component-count";
  readonly defaultValue: number;
}

export type ParameterSchema =
  | NumberParameterSchema
  | IntegerParameterSchema
  | SliderParameterSchema
  | EnumParameterSchema
  | BooleanParameterSchema
  | CubeScopeParameterSchema
  | RasterReferenceParameterSchema
  | BandNumberParameterSchema
  | ComponentCountParameterSchema;

export type ResolvedCubeScopeSelection =
  | { readonly scope: "full-cube" }
  | { readonly scope: "band-wise"; readonly bandIndexes: number[] };

export function resolveCubeScopeSelection(
  choice: CubeScopeChoice,
  selectedBandIndexes: ReadonlyArray<number>,
): ResolvedCubeScopeSelection {
  if (choice === FULL_CUBE_SCOPE) return { scope: "full-cube" };
  return { scope: "band-wise", bandIndexes: sortAndDedupeBandIndexesAscending(selectedBandIndexes) };
}

export function readCubeScopeChoiceOrDefault(
  value: ParameterValue,
  fallback: CubeScopeChoice,
): CubeScopeChoice {
  return value === FULL_CUBE_SCOPE || value === BAND_WISE_SCOPE ? value : fallback;
}

// CT-189: full-stack and band-wise are identical for a single-band stack, so the
// scope radio is a redundant choice there. Hide it for one band; show it once the
// band count is known to exceed one (an unknown count keeps it visible).
export function shouldShowCubeScopeControl(bandCount: number | null): boolean {
  return bandCount === null || bandCount > 1;
}

export function readRasterReferenceTokenOrEmpty(value: ParameterValue | undefined): string {
  return typeof value === "string" ? value : NO_RASTER_REFERENCE_SELECTED;
}

export function readBandRangeTextOrEmpty(value: ParameterValue | undefined): string {
  return typeof value === "string" ? value : "";
}

export function seedBandScopeBandRangeDefaults(
  schemas: ReadonlyArray<ParameterSchema>,
  values: ParameterValuesById,
  currentBandNumber: number,
): ParameterValuesById {
  const seeded: Record<string, ParameterValue> = { ...values };
  for (const schema of schemas) {
    if (schema.kind === "cube-scope") seeded[schema.bandRangeParameterId] = String(currentBandNumber);
  }
  return Object.freeze(seeded);
}

export function describeBandScopeBlockingErrorOrNull(
  schemas: ReadonlyArray<ParameterSchema>,
  values: ParameterValuesById,
  bandCount: number | null,
): string | null {
  for (const schema of schemas) {
    if (schema.kind !== "cube-scope") continue;
    const error = describeBandWiseRangeErrorForSchemaOrNull(schema, values, bandCount);
    if (error) return error;
  }
  return null;
}

function describeBandWiseRangeErrorForSchemaOrNull(
  schema: CubeScopeParameterSchema,
  values: ParameterValuesById,
  bandCount: number | null,
): string | null {
  if (!shouldShowCubeScopeControl(bandCount)) return null;
  const choice = readCubeScopeChoiceOrDefault(values[schema.id] ?? schema.defaultValue, schema.defaultValue);
  if (choice !== BAND_WISE_SCOPE) return null;
  return describeBandRangeErrorOrNull(readBandRangeTextOrEmpty(values[schema.bandRangeParameterId]), bandCount);
}

export function readBandNumberOrDefault(value: ParameterValue | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.round(value);
}

export function describeBandNumberRangeErrorOrNull(
  value: number,
  sourceBandCount: number | null,
): string | null {
  if (!Number.isInteger(value) || value < 1) return "Enter a band number of 1 or higher.";
  if (sourceBandCount !== null && value > sourceBandCount) {
    return `Band must be between 1 and ${sourceBandCount}.`;
  }
  return null;
}

function sortAndDedupeBandIndexesAscending(bandIndexes: ReadonlyArray<number>): number[] {
  return Array.from(new Set(bandIndexes)).sort((a, b) => a - b);
}

export type ParameterValue = number | string | boolean;
export type ParameterValuesById = Readonly<Record<string, ParameterValue>>;

export const NO_PARAMETER_VALUES: ParameterValuesById = Object.freeze({});

export function buildDefaultParameterValuesForSchemas(
  schemas: ReadonlyArray<ParameterSchema>,
): ParameterValuesById {
  const values: Record<string, ParameterValue> = {};
  for (const schema of schemas) values[schema.id] = schema.defaultValue;
  return Object.freeze(values);
}

export function serializeParameterValuesToJsonString(values: ParameterValuesById): string {
  return JSON.stringify(values);
}

export function parseParameterValuesFromJsonString(json: string): ParameterValuesById {
  const parsed: unknown = JSON.parse(json);
  if (!isPlainParameterValuesRecord(parsed)) {
    throw new Error("Parsed JSON is not a parameter values record");
  }
  return Object.freeze({ ...parsed });
}

export function clampNumericParameterValueToSchema(
  schema: NumberParameterSchema | IntegerParameterSchema,
  rawValue: number,
): number {
  const clamped = clampValueToOptionalRange(rawValue, schema.min, schema.max);
  return schema.kind === "integer" ? Math.round(clamped) : clamped;
}

export function clampSliderParameterValueToSchema(
  schema: SliderParameterSchema,
  rawValue: number,
): number {
  return clampValueToOptionalRange(rawValue, schema.min, schema.max);
}

function clampValueToOptionalRange(value: number, min?: number, max?: number): number {
  if (typeof min === "number" && value < min) return min;
  if (typeof max === "number" && value > max) return max;
  return value;
}

function isPlainParameterValuesRecord(value: unknown): value is ParameterValuesById {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return everyEntryIsParameterValue(value as Record<string, unknown>);
}

function everyEntryIsParameterValue(record: Record<string, unknown>): boolean {
  for (const value of Object.values(record)) {
    if (!isParameterValue(value)) return false;
  }
  return true;
}

function isParameterValue(value: unknown): value is ParameterValue {
  return typeof value === "number" || typeof value === "string" || typeof value === "boolean";
}
