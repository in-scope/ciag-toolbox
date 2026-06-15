import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import type { HistoryEntryReadout } from "./history-panel";
import { readHistoryEntries } from "./history-panel";
import type { PixelDimensions } from "./image-pixel-canvas-mapping";
import { readMetadata } from "./metadata-panel";
import { readPixelValueAt } from "./pixel-readout";

// Shared "did the right math happen" assertions for operation specs. Each helper reads
// the app's TRUE state (status-bar readout, History entries, Metadata) and fails with a
// descriptive message, so every operation spec checks its outcome the same way and a
// regression points at the operation rather than at a bespoke per-spec assertion.

export interface ExpectedPixelValue {
  readonly panel: number;
  readonly imageX: number;
  readonly imageY: number;
  readonly dimensions: PixelDimensions;
  readonly expected: number;
  readonly tolerance?: number;
}

// Asserts the TRUE readout value at an image pixel equals the expected number: exactly
// when no tolerance is given (integer operations) or within tolerance (float operations).
export async function expectPixelReadoutToEqual(
  page: Page,
  target: ExpectedPixelValue,
): Promise<void> {
  const readout = await readPixelValueAt(
    page,
    target.panel,
    target.imageX,
    target.imageY,
    target.dimensions,
  );
  const actual = parseReadoutValueToFiniteNumber(readout.value);
  assertNumberEqualsExactlyOrWithinTolerance(actual, target.expected, target.tolerance);
}

function assertNumberEqualsExactlyOrWithinTolerance(
  actual: number,
  expected: number,
  tolerance: number | undefined,
): void {
  if (tolerance === undefined) {
    expect(actual).toBe(expected);
    return;
  }
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

function parseReadoutValueToFiniteNumber(value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Pixel readout value "${value}" is not a finite number`);
  }
  return parsed;
}

export interface ExpectedHistoryEntry {
  readonly actionLabel: string;
  readonly detailSubstrings?: ReadonlyArray<string>;
}

// Asserts a History entry naming the operation (and, when given, recording the expected
// parameter/scope text in its detail lines) is present.
export async function expectHistoryToRecordOperation(
  page: Page,
  expected: ExpectedHistoryEntry,
): Promise<void> {
  const entries = await readHistoryEntries(page);
  const matching = findHistoryEntryNamingOperationWithDetails(entries, expected);
  expect(matching, describeMissingHistoryEntry(expected)).toBeTruthy();
}

function findHistoryEntryNamingOperationWithDetails(
  entries: ReadonlyArray<HistoryEntryReadout>,
  expected: ExpectedHistoryEntry,
): HistoryEntryReadout | undefined {
  return entries.find(
    (entry) =>
      entry.actionLabel === expected.actionLabel &&
      historyEntryDetailLinesContainAll(entry, expected.detailSubstrings ?? []),
  );
}

function historyEntryDetailLinesContainAll(
  entry: HistoryEntryReadout,
  substrings: ReadonlyArray<string>,
): boolean {
  const detailText = entry.detailLines.join(" ");
  return substrings.every((substring) => detailText.includes(substring));
}

function describeMissingHistoryEntry(expected: ExpectedHistoryEntry): string {
  const substrings = expected.detailSubstrings ?? [];
  if (substrings.length === 0) return `History should record a "${expected.actionLabel}" entry`;
  return `History should record a "${expected.actionLabel}" entry mentioning ${substrings.join(", ")}`;
}

export interface ExpectedMetadata {
  readonly dataType: string;
  readonly width: number;
  readonly height: number;
}

// Asserts the Metadata panel reports the expected data type (e.g. "uint8", "float32")
// and pixel dimensions.
export async function expectMetadataDataTypeAndDimensions(
  page: Page,
  expected: ExpectedMetadata,
): Promise<void> {
  const metadata = await readMetadata(page);
  expect(metadata.dataType).toBe(expected.dataType);
  expect(metadata.width).toBe(String(expected.width));
  expect(metadata.height).toBe(String(expected.height));
}
