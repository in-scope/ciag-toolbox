import { useId } from "react";

import { Switch } from "@/components/ui/switch";
import {
  clampNumericParameterValueToSchema,
  type BooleanParameterSchema,
  type EnumParameterSchema,
  type IntegerParameterSchema,
  type NumberParameterSchema,
  type ParameterSchema,
  type ParameterValue,
  type ParameterValuesById,
} from "@/lib/actions/parameter-schema";

interface ParameterFormSectionProps {
  schemas: ReadonlyArray<ParameterSchema>;
  values: ParameterValuesById;
  onChangeValue: (id: string, next: ParameterValue) => void;
}

export function ParameterFormSection(props: ParameterFormSectionProps): JSX.Element {
  return (
    <section className="flex flex-col gap-3" aria-label="Parameters">
      <span className="text-xs font-medium text-muted-foreground">Parameters</span>
      {props.schemas.map((schema) => (
        <ParameterFieldRow
          key={schema.id}
          schema={schema}
          value={props.values[schema.id] ?? schema.defaultValue}
          onChangeValue={(next) => props.onChangeValue(schema.id, next)}
        />
      ))}
    </section>
  );
}

interface ParameterFieldRowProps {
  schema: ParameterSchema;
  value: ParameterValue;
  onChangeValue: (next: ParameterValue) => void;
}

function ParameterFieldRow(props: ParameterFieldRowProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <ParameterFieldInput
        schema={props.schema}
        value={props.value}
        onChangeValue={props.onChangeValue}
      />
      {props.schema.description ? (
        <span className="text-xs text-muted-foreground">{props.schema.description}</span>
      ) : null}
    </div>
  );
}

function ParameterFieldInput(props: ParameterFieldRowProps): JSX.Element {
  if (props.schema.kind === "boolean") {
    return (
      <BooleanParameterField
        schema={props.schema}
        value={readBooleanValueOrDefault(props.value, props.schema.defaultValue)}
        onChangeValue={props.onChangeValue}
      />
    );
  }
  if (props.schema.kind === "enum") {
    return (
      <EnumParameterField
        schema={props.schema}
        value={readStringValueOrDefault(props.value, props.schema.defaultValue)}
        onChangeValue={props.onChangeValue}
      />
    );
  }
  return (
    <NumericParameterField
      schema={props.schema}
      value={readNumericValueOrDefault(props.value, props.schema.defaultValue)}
      onChangeValue={props.onChangeValue}
    />
  );
}

function readNumericValueOrDefault(value: ParameterValue, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function readStringValueOrDefault(value: ParameterValue, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function readBooleanValueOrDefault(value: ParameterValue, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

interface NumericParameterFieldProps {
  schema: NumberParameterSchema | IntegerParameterSchema;
  value: number;
  onChangeValue: (next: number) => void;
}

function NumericParameterField(props: NumericParameterFieldProps): JSX.Element {
  const id = useId();
  const stepValue = resolveNumericInputStep(props.schema);
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm">
      <span className="text-foreground">{props.schema.label}</span>
      <input
        id={id}
        type="number"
        value={props.value}
        min={props.schema.min}
        max={props.schema.max}
        step={stepValue}
        onChange={(event) =>
          props.onChangeValue(
            clampNumericParameterValueToSchema(
              props.schema,
              parseNumericInputValueOrFallback(event.target.value, props.value),
            ),
          )
        }
        className={NUMERIC_INPUT_CLASSES}
      />
    </label>
  );
}

const NUMERIC_INPUT_CLASSES =
  "h-8 rounded-md border bg-background px-2 font-mono text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring";

function resolveNumericInputStep(
  schema: NumberParameterSchema | IntegerParameterSchema,
): number | string {
  if (schema.kind === "integer") return 1;
  return schema.step ?? "any";
}

function parseNumericInputValueOrFallback(rawValue: string, fallback: number): number {
  const trimmed = rawValue.trim();
  if (trimmed === "") return fallback;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
}

interface EnumParameterFieldProps {
  schema: EnumParameterSchema;
  value: string;
  onChangeValue: (next: string) => void;
}

function EnumParameterField(props: EnumParameterFieldProps): JSX.Element {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm">
      <span className="text-foreground">{props.schema.label}</span>
      <select
        id={id}
        value={props.value}
        onChange={(event) => props.onChangeValue(event.target.value)}
        className={ENUM_SELECT_CLASSES}
      >
        {props.schema.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const ENUM_SELECT_CLASSES =
  "h-8 rounded-md border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring";

interface BooleanParameterFieldProps {
  schema: BooleanParameterSchema;
  value: boolean;
  onChangeValue: (next: boolean) => void;
}

function BooleanParameterField(props: BooleanParameterFieldProps): JSX.Element {
  const id = useId();
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center justify-between gap-3 text-sm">
      <span className="text-foreground">{props.schema.label}</span>
      <Switch id={id} checked={props.value} onCheckedChange={props.onChangeValue} />
    </label>
  );
}
