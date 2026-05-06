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

export type ParameterSchema =
  | NumberParameterSchema
  | IntegerParameterSchema
  | EnumParameterSchema
  | BooleanParameterSchema;

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
