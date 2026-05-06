import { SELECTABLE_GRID_LAYOUTS, type GridLayout } from "@/lib/grid/grid-layout";

import {
  IDENTITY_PROJECT_VIEWPORT_VIEW_TRANSFORM,
  PROJECT_FILE_FORMAT_VERSION,
  type ProjectFile,
  type ProjectViewportEntry,
  type ProjectViewportRenderingState,
  type ProjectViewportSourceReference,
  type ProjectViewportViewTransform,
} from "./project-schema";

export function parseProjectFileFromJsonString(json: string): ProjectFile {
  const parsed: unknown = JSON.parse(json);
  return validateParsedRootIsProjectFile(parsed);
}

function validateParsedRootIsProjectFile(value: unknown): ProjectFile {
  const root = expectRecordOrThrow(value, "project file root");
  ensureFormatVersionIsSupported(root["formatVersion"]);
  return {
    formatVersion: PROJECT_FILE_FORMAT_VERSION,
    gridLayout: parseGridLayoutOrThrow(root["gridLayout"]),
    selectedViewportIndices: parseSelectedIndicesOrThrow(root["selectedViewportIndices"]),
    viewports: parseViewportsOrThrow(root["viewports"]),
  };
}

function ensureFormatVersionIsSupported(value: unknown): void {
  if (value !== PROJECT_FILE_FORMAT_VERSION) {
    throw new Error(
      `Unsupported project file format version: ${String(value)} (expected ${PROJECT_FILE_FORMAT_VERSION})`,
    );
  }
}

function parseGridLayoutOrThrow(value: unknown): GridLayout {
  if (typeof value !== "string" || !isSelectableGridLayout(value)) {
    throw new Error(`Unknown grid layout in project file: ${String(value)}`);
  }
  return value;
}

function isSelectableGridLayout(value: string): value is GridLayout {
  return (SELECTABLE_GRID_LAYOUTS as ReadonlyArray<string>).includes(value);
}

function parseSelectedIndicesOrThrow(value: unknown): ReadonlyArray<number> {
  if (!Array.isArray(value)) {
    throw new Error("selectedViewportIndices must be an array");
  }
  return value.map(expectFiniteNonNegativeIntegerOrThrow);
}

function parseViewportsOrThrow(value: unknown): ReadonlyArray<ProjectViewportEntry> {
  if (!Array.isArray(value)) {
    throw new Error("viewports must be an array");
  }
  return value.map(parseViewportEntryOrThrow);
}

function parseViewportEntryOrThrow(value: unknown): ProjectViewportEntry {
  const entry = expectRecordOrThrow(value, "viewport entry");
  return {
    index: expectFiniteNonNegativeIntegerOrThrow(entry["index"]),
    source: parseSourceReferenceOrThrow(entry["source"]),
    renderingState: parseRenderingStateOrThrow(entry["renderingState"]),
    viewTransform: parseViewTransformOrIdentity(entry["viewTransform"]),
    operationHistory: parseOperationHistoryOrEmpty(entry["operationHistory"]),
    roi: null,
  };
}

function parseSourceReferenceOrThrow(value: unknown): ProjectViewportSourceReference {
  const ref = expectRecordOrThrow(value, "viewport source reference");
  return {
    relativePath: expectNonEmptyStringOrThrow(ref["relativePath"], "source.relativePath"),
    contentHash: expectNonEmptyStringOrThrow(ref["contentHash"], "source.contentHash"),
    fileName: expectNonEmptyStringOrThrow(ref["fileName"], "source.fileName"),
  };
}

function parseRenderingStateOrThrow(value: unknown): ProjectViewportRenderingState {
  const state = expectRecordOrThrow(value, "renderingState");
  return {
    normalizationEnabled: expectBooleanOrThrow(state["normalizationEnabled"], "normalizationEnabled"),
    selectedBandIndex: expectFiniteNonNegativeIntegerOrThrow(state["selectedBandIndex"]),
    lastAppliedOperationLabel: parseOptionalNullableString(state["lastAppliedOperationLabel"]),
  };
}

function parseViewTransformOrIdentity(value: unknown): ProjectViewportViewTransform {
  if (!isPlainRecord(value)) return IDENTITY_PROJECT_VIEWPORT_VIEW_TRANSFORM;
  return {
    zoom: parseFiniteNumberOr(value["zoom"], IDENTITY_PROJECT_VIEWPORT_VIEW_TRANSFORM.zoom),
    panX: parseFiniteNumberOr(value["panX"], IDENTITY_PROJECT_VIEWPORT_VIEW_TRANSFORM.panX),
    panY: parseFiniteNumberOr(value["panY"], IDENTITY_PROJECT_VIEWPORT_VIEW_TRANSFORM.panY),
  };
}

function parseOperationHistoryOrEmpty(value: unknown): ReadonlyArray<unknown> {
  if (!Array.isArray(value)) return [];
  return value.slice();
}

function expectRecordOrThrow(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectNonEmptyStringOrThrow(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function expectBooleanOrThrow(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function expectFiniteNonNegativeIntegerOrThrow(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Expected a non-negative integer, got ${String(value)}`);
  }
  return value;
}

function parseFiniteNumberOr(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return value;
}

function parseOptionalNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  return value;
}
