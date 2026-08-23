import type {
  BooleanParameterSchema,
  IntegerParameterSchema,
  ParameterSchema,
  ParameterValue,
  ParameterValuesById,
} from "./parameter-schema";

// CT-311: the tunables of the built-in spatially adaptive projections
// (resources/builtin-python/local_pca.py, and local_mnf.py behind it). Both
// adapt one client script whose signature is
// localPCA(cube, pcaStep, radius = None, meanCenter = True), so the panel
// exposes exactly those three, each defaulting to the script's own default:
// step (the built-in's DEFAULT_STEP of 8), radius (None, meaning "match the
// step"), and meanCenter (True). A radius field cannot hold None, so the
// integer field carries RADIUS_MATCHING_STEP (0) for that default and the
// execute params translate it back to null.

export const LOCAL_PROJECTION_STEP_PARAMETER_ID = "localProjectionStep";
export const LOCAL_PROJECTION_RADIUS_PARAMETER_ID = "localProjectionRadius";
export const LOCAL_PROJECTION_MEAN_CENTER_PARAMETER_ID = "localProjectionMeanCenter";

export const DEFAULT_LOCAL_PROJECTION_STEP = 8;
export const RADIUS_MATCHING_STEP = 0;
export const DEFAULT_LOCAL_PROJECTION_MEAN_CENTER = true;

const LARGEST_OFFERED_STEP = 4096;
const LARGEST_OFFERED_RADIUS = 4096;

export interface LocalProjectionSettings {
  readonly step: number;
  // null reproduces the script's radius = None default (radius becomes step).
  readonly radius: number | null;
  readonly meanCenter: boolean;
}

export function buildLocalProjectionParameterSchemas(
  operationLabel: string,
): ReadonlyArray<ParameterSchema> {
  return [
    buildStepParameterSchema(operationLabel),
    buildRadiusParameterSchema(),
    buildMeanCenterParameterSchema(),
  ];
}

function buildStepParameterSchema(operationLabel: string): IntegerParameterSchema {
  return {
    kind: "integer",
    id: LOCAL_PROJECTION_STEP_PARAMETER_ID,
    label: "Stride",
    description:
      `How many pixels to skip between local ${operationLabel} fits. ` +
      "A larger stride is faster and coarser.",
    defaultValue: DEFAULT_LOCAL_PROJECTION_STEP,
    min: 1,
    max: LARGEST_OFFERED_STEP,
  };
}

function buildRadiusParameterSchema(): IntegerParameterSchema {
  return {
    kind: "integer",
    id: LOCAL_PROJECTION_RADIUS_PARAMETER_ID,
    label: "Kernel radius",
    description:
      "Radius in pixels of the box kernel each local fit sees. " +
      "0 matches the stride, which is the algorithm's own default.",
    defaultValue: RADIUS_MATCHING_STEP,
    min: RADIUS_MATCHING_STEP,
    max: LARGEST_OFFERED_RADIUS,
  };
}

function buildMeanCenterParameterSchema(): BooleanParameterSchema {
  return {
    kind: "boolean",
    id: LOCAL_PROJECTION_MEAN_CENTER_PARAMETER_ID,
    label: "Subtract local mean",
    description: "Subtract each pixel's local box-kernel mean before projecting.",
    defaultValue: DEFAULT_LOCAL_PROJECTION_MEAN_CENTER,
  };
}

export function readLocalProjectionSettings(
  parameterValues: ParameterValuesById,
): LocalProjectionSettings {
  return {
    step: readStepOrDefault(parameterValues[LOCAL_PROJECTION_STEP_PARAMETER_ID]),
    radius: readRadiusOrNullWhenMatchingStep(
      parameterValues[LOCAL_PROJECTION_RADIUS_PARAMETER_ID],
    ),
    meanCenter: readMeanCenterOrDefault(
      parameterValues[LOCAL_PROJECTION_MEAN_CENTER_PARAMETER_ID],
    ),
  };
}

function readStepOrDefault(value: ParameterValue | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_LOCAL_PROJECTION_STEP;
  return Math.max(1, Math.round(value));
}

function readRadiusOrNullWhenMatchingStep(value: ParameterValue | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.max(RADIUS_MATCHING_STEP, Math.round(value));
  return rounded === RADIUS_MATCHING_STEP ? null : rounded;
}

function readMeanCenterOrDefault(value: ParameterValue | undefined): boolean {
  return typeof value === "boolean" ? value : DEFAULT_LOCAL_PROJECTION_MEAN_CENTER;
}

// The params dict run(cube, wavelengths, params) receives; the keys are the
// built-in script's own parameter names.
export function buildLocalProjectionExecuteParams(
  settings: LocalProjectionSettings,
): Record<string, unknown> {
  return { step: settings.step, radius: settings.radius, meanCenter: settings.meanCenter };
}

export function resolveLocalProjectionKernelRadius(settings: LocalProjectionSettings): number {
  return settings.radius ?? settings.step;
}

export function formatLocalProjectionAppliedLabel(
  operationLabel: string,
  parameterValues: ParameterValuesById,
): string {
  const settings = readLocalProjectionSettings(parameterValues);
  return (
    `${operationLabel} (stride ${settings.step}, ` +
    `kernel radius ${resolveLocalProjectionKernelRadius(settings)}, ` +
    `${describeMeanCentering(settings.meanCenter)})`
  );
}

function describeMeanCentering(meanCenter: boolean): string {
  return meanCenter ? "local mean subtracted" : "no local mean subtraction";
}
