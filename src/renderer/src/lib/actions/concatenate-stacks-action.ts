import { Combine } from "lucide-react";

import { concatenateRasterStacks } from "@/lib/image/concatenate-stacks";
import { coerceViewportSourceToRasterSource } from "@/lib/image/promote-source-to-raster";
import type { RasterImage } from "@/lib/image/raster-image";
import { readRememberedReferenceRasterOrNull } from "@/lib/image/reference-raster-store";
import { readReferenceTokenDisplayName } from "@/lib/image/reference-token";

import {
  NO_RASTER_REFERENCE_SELECTED,
  readRasterReferenceTokenOrEmpty,
  type ParameterValuesById,
  type RasterReferenceParameterSchema,
} from "./parameter-schema";
import type { RegisteredViewportAction } from "./registered-actions";
import type { ViewportActionSourceTransform } from "./viewport-action";

// CT-300: concatenate the active stack's bands with a second open stack of the
// same width/height, in place (active bands first, then the second stack's).
// The second stack is picked from already-loaded panels only, restricted to
// panels whose spatial dimensions match (see RasterReferenceParameterSchema's
// restrictToLoadedPanelsMatchingSourceDimensions flag).

export const CONCATENATE_STACKS_ACTION_ID = "concatenate-stacks";
export const CONCATENATE_STACKS_SECOND_STACK_PARAMETER_ID = "secondStackToken";
const SECOND_STACK_PARAMETER_ID = CONCATENATE_STACKS_SECOND_STACK_PARAMETER_ID;

const SECOND_STACK_PARAMETER_SCHEMA: RasterReferenceParameterSchema = {
  kind: "raster-reference",
  id: SECOND_STACK_PARAMETER_ID,
  label: "Second stack",
  description:
    "An open stack with the same width and height as the active stack. Its bands are appended after the active stack's bands.",
  optional: false,
  defaultValue: NO_RASTER_REFERENCE_SELECTED,
  restrictToLoadedPanelsMatchingSourceDimensions: true,
};

export const CONCATENATE_STACKS_ACTION: RegisteredViewportAction = {
  id: CONCATENATE_STACKS_ACTION_ID,
  label: "Concatenate Stacks",
  icon: Combine,
  parameters: [SECOND_STACK_PARAMETER_SCHEMA],
  successMessage: "Stacks concatenated",
  appliedLabel: "Concatenate Stacks",
  loadingMessage: "Concatenating stacks...",
  formatAppliedLabel: formatConcatenateStacksAppliedLabel,
  apply: (state) => state,
  transformSource: createConcatenateStacksSourceTransform(),
};

function createConcatenateStacksSourceTransform(): ViewportActionSourceTransform {
  return (rawSource, parameterValues) => {
    const source = coerceViewportSourceToRasterSource(rawSource);
    const second = resolveRequiredSecondStackOrThrow(parameterValues);
    return { kind: "raster", raster: concatenateRasterStacks(source.raster, second) };
  };
}

function resolveRequiredSecondStackOrThrow(parameterValues: ParameterValuesById): RasterImage {
  const token = readRasterReferenceTokenOrEmpty(parameterValues[SECOND_STACK_PARAMETER_ID]);
  if (token === NO_RASTER_REFERENCE_SELECTED) {
    throw new Error("Choose a second stack before applying Concatenate Stacks.");
  }
  const raster = readRememberedReferenceRasterOrNull(token);
  if (!raster) {
    throw new Error("The second stack is no longer loaded. Choose it again and try again.");
  }
  return raster;
}

function formatConcatenateStacksAppliedLabel(parameterValues: ParameterValuesById): string {
  const token = readRasterReferenceTokenOrEmpty(parameterValues[SECOND_STACK_PARAMETER_ID]);
  const name = token === NO_RASTER_REFERENCE_SELECTED ? "none" : readReferenceTokenDisplayName(token);
  return `Concatenate Stacks (with ${name})`;
}
