import type { ParameterValuesById } from "./parameter-schema";

export interface ViewportOperationHistoryEntry {
  readonly actionId: string;
  readonly actionLabel: string;
  readonly appliedLabel: string;
  readonly parameterValues: ParameterValuesById;
  readonly timestampMs: number;
}

export type ViewportOperationHistory = ReadonlyArray<ViewportOperationHistoryEntry>;

export const EMPTY_OPERATION_HISTORY: ViewportOperationHistory = Object.freeze([]);

export interface OperationHistoryEntryDraft {
  readonly actionId: string;
  readonly actionLabel: string;
  readonly appliedLabel: string;
  readonly parameterValues: ParameterValuesById;
}

export function appendOperationHistoryEntry(
  history: ViewportOperationHistory,
  draft: OperationHistoryEntryDraft,
  nowMs: number = Date.now(),
): ViewportOperationHistory {
  return [...history, buildOperationHistoryEntryFromDraft(draft, nowMs)];
}

function buildOperationHistoryEntryFromDraft(
  draft: OperationHistoryEntryDraft,
  nowMs: number,
): ViewportOperationHistoryEntry {
  return {
    actionId: draft.actionId,
    actionLabel: draft.actionLabel,
    appliedLabel: draft.appliedLabel,
    parameterValues: Object.freeze({ ...draft.parameterValues }),
    timestampMs: nowMs,
  };
}

export function formatOperationHistoryParameterValuesAsInlineText(
  parameterValues: ParameterValuesById,
): string {
  const keys = Object.keys(parameterValues).sort();
  if (keys.length === 0) return "";
  return keys.map((key) => `${key}: ${formatParameterValueForDisplay(parameterValues[key])}`).join(", ");
}

function formatParameterValueForDisplay(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return String(value);
}

export function formatOperationHistoryTimestampForDisplay(timestampMs: number): string {
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) return "";
  return formatHoursAndMinutesAndSecondsForDisplay(date);
}

function formatHoursAndMinutesAndSecondsForDisplay(date: Date): string {
  const hours = padTwoDigits(date.getHours());
  const minutes = padTwoDigits(date.getMinutes());
  const seconds = padTwoDigits(date.getSeconds());
  return `${hours}:${minutes}:${seconds}`;
}

function padTwoDigits(value: number): string {
  return value.toString().padStart(2, "0");
}
