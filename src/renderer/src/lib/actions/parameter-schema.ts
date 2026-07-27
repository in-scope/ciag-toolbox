import { describeBandRangeErrorOrNull } from "@/lib/image/parse-band-range";

export interface ParameterSchemaBase {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  // CT-194: only render this field when another parameter equals a given value
  // (e.g. the clip lo/hi inputs appear only when the method is "Clip by value").
  readonly visibleWhen?: ParameterVisibilityCondition;
  // CT-247: hide this field when the source is a true-colour composite (e.g. the
  // Brightness & Contrast "Apply to all bands" switch - a photo always adjusts
  // all three channels, so the choice would be meaningless there).
  readonly hiddenForTrueColorComposite?: boolean;
}

export interface ParameterVisibilityCondition {
  readonly parameterId: string;
  readonly equals: string;
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
  // CT-257: for a log-symmetric slider the Radix track runs over positions
  // 0..1, step is the POSITION step, and min must equal 1 / max so the track
  // center maps to exactly 1 (see log-symmetric-slider-scale.ts). Linear
  // sliders keep step in value units.
  readonly step: number;
  readonly valueSuffix?: string;
  readonly scale?: "log-symmetric";
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
  // CT-251: when set, an empty band-wise field is VALID and means "every band"
  // (Normalize, Standardize, spatial filter, denoise, percentile clip).
  // Threshold keeps the flag off, so its empty field still blocks Apply.
  readonly emptyBandRangeMeansAllBands?: boolean;
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

// CT-194: a paired low/high numeric control for the absolute clip-by-value method.
// It owns two underlying parameter values (loParameterId / hiParameterId) so the
// "high must exceed low" validation can render one inline error across both inputs.
export interface ClipBoundsParameterSchema extends ParameterSchemaBase {
  readonly kind: "clip-bounds";
  readonly loParameterId: string;
  readonly hiParameterId: string;
  readonly loLabel: string;
  readonly hiLabel: string;
  readonly defaultLo: number;
  readonly defaultHi: number;
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
  | ComponentCountParameterSchema
  | ClipBoundsParameterSchema;

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

// CT-194: a field is shown unless its visibleWhen condition fails to match the
// current values (e.g. the clip lo/hi inputs require method === clip-by-value).
export function isParameterSchemaVisible(
  schema: ParameterSchema,
  values: ParameterValuesById,
): boolean {
  if (!schema.visibleWhen) return true;
  return values[schema.visibleWhen.parameterId] === schema.visibleWhen.equals;
}

// CT-247: source-aware visibility on top of the value-driven CT-194 gate: a field
// flagged hiddenForTrueColorComposite disappears when the source is a photo.
export function isParameterSchemaVisibleForSource(
  schema: ParameterSchema,
  values: ParameterValuesById,
  sourceIsTrueColorComposite: boolean,
): boolean {
  if (schema.hiddenForTrueColorComposite && sourceIsTrueColorComposite) return false;
  return isParameterSchemaVisible(schema, values);
}

export function readClipBoundOrDefault(value: ParameterValue | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// CT-194: clip-by-value needs a usable range, so the high bound must exceed the low.
export function describeClipBoundsErrorOrNull(lo: number, hi: number): string | null {
  if (hi > lo) return null;
  return "Enter a high value greater than the low value.";
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

// CT-194: every parameter-level reason Apply must stay disabled, evaluated only
// for currently-visible fields (a hidden clip-bounds control cannot block Apply).
export function describeBlockingParameterErrorOrNull(
  schemas: ReadonlyArray<ParameterSchema>,
  values: ParameterValuesById,
  bandCount: number | null,
): string | null {
  const bandScopeError = describeBandScopeBlockingErrorOrNull(schemas, values, bandCount);
  if (bandScopeError) return bandScopeError;
  return describeClipBoundsBlockingErrorOrNull(schemas, values);
}

function describeClipBoundsBlockingErrorOrNull(
  schemas: ReadonlyArray<ParameterSchema>,
  values: ParameterValuesById,
): string | null {
  for (const schema of schemas) {
    if (schema.kind !== "clip-bounds" || !isParameterSchemaVisible(schema, values)) continue;
    const error = describeClipBoundsErrorForSchemaOrNull(schema, values);
    if (error) return error;
  }
  return null;
}

function describeClipBoundsErrorForSchemaOrNull(
  schema: ClipBoundsParameterSchema,
  values: ParameterValuesById,
): string | null {
  const lo = readClipBoundOrDefault(values[schema.loParameterId], schema.defaultLo);
  const hi = readClipBoundOrDefault(values[schema.hiParameterId], schema.defaultHi);
  return describeClipBoundsErrorOrNull(lo, hi);
}

function describeBandWiseRangeErrorForSchemaOrNull(
  schema: CubeScopeParameterSchema,
  values: ParameterValuesById,
  bandCount: number | null,
): string | null {
  if (!shouldShowCubeScopeControl(bandCount)) return null;
  const choice = readCubeScopeChoiceOrDefault(values[schema.id] ?? schema.defaultValue, schema.defaultValue);
  if (choice !== BAND_WISE_SCOPE) return null;
  return describeCubeScopeBandRangeErrorOrNull(
    schema,
    readBandRangeTextOrEmpty(values[schema.bandRangeParameterId]),
    bandCount,
  );
}

// CT-251: the single validity rule for a cube-scope band field, shared by the
// Apply gate above and the inline field error in parameter-form-section.tsx.
export function describeCubeScopeBandRangeErrorOrNull(
  schema: CubeScopeParameterSchema,
  bandRangeText: string,
  bandCount: number | null,
): string | null {
  if (schema.emptyBandRangeMeansAllBands && bandRangeText.trim() === "") return null;
  return describeBandRangeErrorOrNull(bandRangeText, bandCount);
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
  for (const schema of schemas) seedSchemaDefaultValues(values, schema);
  return Object.freeze(values);
}

function seedSchemaDefaultValues(values: Record<string, ParameterValue>, schema: ParameterSchema): void {
  if (schema.kind === "clip-bounds") {
    values[schema.loParameterId] = schema.defaultLo;
    values[schema.hiParameterId] = schema.defaultHi;
    return;
  }
  values[schema.id] = schema.defaultValue;
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
