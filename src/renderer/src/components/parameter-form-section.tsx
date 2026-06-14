import { useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { pickAndRememberReferenceRasterFromDisk } from "@/lib/image/pick-reference-raster";
import { describeBandRangeErrorOrNull } from "@/lib/image/parse-band-range";
import {
  clampNumericParameterValueToSchema,
  clampSliderParameterValueToSchema,
  describeBandNumberRangeErrorOrNull,
  readBandNumberOrDefault,
  readBandRangeTextOrEmpty,
  readCubeScopeChoiceOrDefault,
  readRasterReferenceTokenOrEmpty,
  NO_RASTER_REFERENCE_SELECTED,
  type BandNumberParameterSchema,
  type BooleanParameterSchema,
  type CubeScopeChoice,
  type CubeScopeParameterSchema,
  type EnumParameterSchema,
  type IntegerParameterSchema,
  type NumberParameterSchema,
  type ParameterSchema,
  type RasterReferenceParameterSchema,
  type SliderParameterSchema,
  type ParameterValue,
  type ParameterValuesById,
} from "@/lib/actions/parameter-schema";

interface ParameterFormSectionProps {
  schemas: ReadonlyArray<ParameterSchema>;
  values: ParameterValuesById;
  onChangeValue: (id: string, next: ParameterValue) => void;
  sourceBandCount?: number | null;
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
          allValues={props.values}
          sourceBandCount={props.sourceBandCount ?? null}
          onChangeValue={(next) => props.onChangeValue(schema.id, next)}
          onChangeValueAtId={props.onChangeValue}
        />
      ))}
    </section>
  );
}

interface ParameterFieldRowProps {
  schema: ParameterSchema;
  value: ParameterValue;
  allValues: ParameterValuesById;
  sourceBandCount: number | null;
  onChangeValue: (next: ParameterValue) => void;
  onChangeValueAtId: (id: string, next: ParameterValue) => void;
}

function ParameterFieldRow(props: ParameterFieldRowProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <ParameterFieldInput
        schema={props.schema}
        value={props.value}
        allValues={props.allValues}
        sourceBandCount={props.sourceBandCount}
        onChangeValue={props.onChangeValue}
        onChangeValueAtId={props.onChangeValueAtId}
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
  if (props.schema.kind === "cube-scope") {
    const bandRangeParameterId = props.schema.bandRangeParameterId;
    return (
      <CubeScopeParameterField
        schema={props.schema}
        value={readCubeScopeChoiceOrDefault(props.value, props.schema.defaultValue)}
        bandRangeText={readBandRangeTextOrEmpty(props.allValues[bandRangeParameterId])}
        sourceBandCount={props.sourceBandCount}
        onChangeValue={props.onChangeValue}
        onChangeBandRangeText={(next) => props.onChangeValueAtId(bandRangeParameterId, next)}
      />
    );
  }
  if (props.schema.kind === "raster-reference") {
    return (
      <RasterReferenceParameterField
        schema={props.schema}
        value={readRasterReferenceTokenOrEmpty(props.value)}
        onChangeValue={props.onChangeValue}
      />
    );
  }
  if (props.schema.kind === "slider") {
    return (
      <SliderParameterField
        schema={props.schema}
        value={readNumericValueOrDefault(props.value, props.schema.defaultValue)}
        onChangeValue={props.onChangeValue}
      />
    );
  }
  if (props.schema.kind === "band-number") {
    return (
      <BandNumberParameterField
        schema={props.schema}
        value={readNumericValueOrDefault(props.value, props.schema.defaultValue)}
        sourceBandCount={props.sourceBandCount}
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

interface BandNumberParameterFieldProps {
  schema: BandNumberParameterSchema;
  value: number;
  sourceBandCount: number | null;
  onChangeValue: (next: number) => void;
}

function BandNumberParameterField(props: BandNumberParameterFieldProps): JSX.Element {
  const id = useId();
  const rangeError = describeBandNumberRangeErrorOrNull(props.value, props.sourceBandCount);
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm">
      <span className="text-foreground">{props.schema.label}</span>
      <input
        id={id}
        type="number"
        value={props.value}
        min={1}
        max={props.sourceBandCount ?? undefined}
        step={1}
        aria-invalid={rangeError !== null}
        onChange={(event) =>
          props.onChangeValue(readBandNumberOrDefault(parseNumericInputValueOrFallback(event.target.value, props.value), props.value))
        }
        className={cn(NUMERIC_INPUT_CLASSES, rangeError && "border-destructive focus:ring-destructive")}
      />
      {rangeError ? <span className="text-xs text-destructive">{rangeError}</span> : null}
    </label>
  );
}

interface SliderParameterFieldProps {
  schema: SliderParameterSchema;
  value: number;
  onChangeValue: (next: number) => void;
}

function SliderParameterField(props: SliderParameterFieldProps): JSX.Element {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-foreground">
          {props.schema.label}
        </label>
        <span className="font-mono text-xs text-muted-foreground">
          {formatSliderValueWithSuffix(props.value, props.schema.valueSuffix)}
        </span>
      </div>
      <Slider
        id={id}
        aria-label={props.schema.label}
        min={props.schema.min}
        max={props.schema.max}
        step={props.schema.step}
        value={[props.value]}
        onValueChange={(values) =>
          props.onChangeValue(clampSliderParameterValueToSchema(props.schema, values[0] ?? props.value))
        }
      />
    </div>
  );
}

function formatSliderValueWithSuffix(value: number, valueSuffix: string | undefined): string {
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return valueSuffix ? `${formatted}${valueSuffix}` : formatted;
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

interface CubeScopeParameterFieldProps {
  schema: CubeScopeParameterSchema;
  value: CubeScopeChoice;
  bandRangeText: string;
  sourceBandCount: number | null;
  onChangeValue: (next: CubeScopeChoice) => void;
  onChangeBandRangeText: (next: string) => void;
}

function CubeScopeParameterField(props: CubeScopeParameterFieldProps): JSX.Element {
  const radioGroupName = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm text-foreground">{props.schema.label}</legend>
      <CubeScopeRadioRow
        radioGroupName={radioGroupName}
        choice="full-cube"
        label="Full stack"
        currentChoice={props.value}
        onSelect={props.onChangeValue}
      />
      <CubeScopeRadioRow
        radioGroupName={radioGroupName}
        choice="band-wise"
        label="Band-wise (enter bands)"
        currentChoice={props.value}
        onSelect={props.onChangeValue}
      />
      {props.value === "band-wise" ? (
        <BandRangeTextInput
          value={props.bandRangeText}
          sourceBandCount={props.sourceBandCount}
          onChangeValue={props.onChangeBandRangeText}
        />
      ) : null}
    </fieldset>
  );
}

interface BandRangeTextInputProps {
  value: string;
  sourceBandCount: number | null;
  onChangeValue: (next: string) => void;
}

function BandRangeTextInput(props: BandRangeTextInputProps): JSX.Element {
  const id = useId();
  const rangeError = describeBandRangeErrorOrNull(props.value, props.sourceBandCount);
  return (
    <div className="flex flex-col gap-1 pl-6 text-sm">
      <input
        id={id}
        type="text"
        value={props.value}
        placeholder="1,3,5 or 1-5,10"
        aria-label="Bands to process"
        aria-invalid={rangeError !== null}
        onChange={(event) => props.onChangeValue(event.target.value)}
        className={cn(NUMERIC_INPUT_CLASSES, rangeError && "border-destructive focus:ring-destructive")}
      />
      {rangeError ? <span className="text-xs text-destructive">{rangeError}</span> : null}
    </div>
  );
}

interface CubeScopeRadioRowProps {
  radioGroupName: string;
  choice: CubeScopeChoice;
  label: string;
  currentChoice: CubeScopeChoice;
  onSelect: (choice: CubeScopeChoice) => void;
}

function CubeScopeRadioRow(props: CubeScopeRadioRowProps): JSX.Element {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="radio"
        className="size-4 cursor-pointer accent-primary"
        name={props.radioGroupName}
        checked={props.currentChoice === props.choice}
        onChange={() => props.onSelect(props.choice)}
      />
      <span>{props.label}</span>
    </label>
  );
}

interface RasterReferenceParameterFieldProps {
  schema: RasterReferenceParameterSchema;
  value: string;
  onChangeValue: (next: string) => void;
}

function RasterReferenceParameterField(props: RasterReferenceParameterFieldProps): JSX.Element {
  const [isPicking, setIsPicking] = useState(false);
  const selectedFileName = readBaseFileNameFromTokenOrNull(props.value);
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <span className="text-foreground">{props.schema.label}</span>
      <RasterReferenceSelectedFileText fileName={selectedFileName} optional={props.schema.optional} />
      <RasterReferencePickerButtons
        hasSelection={selectedFileName !== null}
        optional={props.schema.optional}
        isPicking={isPicking}
        onPick={() => void pickReferenceRasterIntoField(props.onChangeValue, setIsPicking)}
        onClear={() => props.onChangeValue(NO_RASTER_REFERENCE_SELECTED)}
      />
    </div>
  );
}

async function pickReferenceRasterIntoField(
  onChangeValue: (next: string) => void,
  setIsPicking: (next: boolean) => void,
): Promise<void> {
  setIsPicking(true);
  try {
    const picked = await pickAndRememberReferenceRasterFromDisk();
    if (picked) onChangeValue(picked.token);
  } catch (error) {
    toast.error(describeReferencePickError(error));
  } finally {
    setIsPicking(false);
  }
}

function describeReferencePickError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readBaseFileNameFromTokenOrNull(token: string): string | null {
  if (token === NO_RASTER_REFERENCE_SELECTED) return null;
  const segments = token.split(/[\\/]/);
  return segments[segments.length - 1] ?? token;
}

interface RasterReferenceSelectedFileTextProps {
  fileName: string | null;
  optional: boolean;
}

function RasterReferenceSelectedFileText(props: RasterReferenceSelectedFileTextProps): JSX.Element {
  if (props.fileName) {
    return (
      <span className="truncate font-mono text-xs text-foreground" title={props.fileName}>
        {props.fileName}
      </span>
    );
  }
  return (
    <span className="text-xs text-muted-foreground">
      {props.optional ? "No file selected (optional)" : "No file selected"}
    </span>
  );
}

interface RasterReferencePickerButtonsProps {
  hasSelection: boolean;
  optional: boolean;
  isPicking: boolean;
  onPick: () => void;
  onClear: () => void;
}

function RasterReferencePickerButtons(props: RasterReferencePickerButtonsProps): JSX.Element {
  return (
    <div className="flex gap-2">
      <Button type="button" variant="outline" size="sm" disabled={props.isPicking} onClick={props.onPick}>
        {props.hasSelection ? "Replace file..." : "Choose file..."}
      </Button>
      {props.optional && props.hasSelection ? (
        <Button type="button" variant="ghost" size="sm" onClick={props.onClear}>
          Clear
        </Button>
      ) : null}
    </div>
  );
}

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
