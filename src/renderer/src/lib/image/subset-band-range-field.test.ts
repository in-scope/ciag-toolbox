import { describe, expect, it } from "vitest";

import {
  SUBSET_BANDS_RANGE_FIELD_HINT,
  deriveKeptBandSelectionFromTypedRangeText,
  describeTypedRangeFieldErrorOrNull,
} from "./subset-band-range-field";

describe("deriveKeptBandSelectionFromTypedRangeText", () => {
  it("selects exactly the typed bands as zero-based indexes", () => {
    const outcome = deriveKeptBandSelectionFromTypedRangeText("1,3", 3);
    expect(outcome).toEqual({ kind: "selection", keptBandIndexes: new Set([0, 2]) });
  });

  it("expands a dash range", () => {
    const outcome = deriveKeptBandSelectionFromTypedRangeText("2-3", 3);
    expect(outcome).toEqual({ kind: "selection", keptBandIndexes: new Set([1, 2]) });
  });

  it("mixes list and range entries with dedupe", () => {
    const outcome = deriveKeptBandSelectionFromTypedRangeText("1,1-2", 5);
    expect(outcome).toEqual({ kind: "selection", keptBandIndexes: new Set([0, 1]) });
  });

  it("returns the full typed selection regardless of any prior checkbox state (re-typing overrides)", () => {
    const first = deriveKeptBandSelectionFromTypedRangeText("1", 3);
    const second = deriveKeptBandSelectionFromTypedRangeText("2-3", 3);
    expect(first).toEqual({ kind: "selection", keptBandIndexes: new Set([0]) });
    expect(second).toEqual({ kind: "selection", keptBandIndexes: new Set([1, 2]) });
  });

  it("is neutral for an empty or whitespace-only field", () => {
    expect(deriveKeptBandSelectionFromTypedRangeText("", 3)).toEqual({ kind: "neutral" });
    expect(deriveKeptBandSelectionFromTypedRangeText("   ", 3)).toEqual({ kind: "neutral" });
  });

  it("rejects unparsable text with the parser's error and no selection", () => {
    const outcome = deriveKeptBandSelectionFromTypedRangeText("abc", 3);
    expect(outcome.kind).toBe("invalid");
    if (outcome.kind === "invalid") expect(outcome.error).toContain("abc");
  });

  it("rejects an out-of-range index entirely, never partially selecting the in-range bands", () => {
    const outcome = deriveKeptBandSelectionFromTypedRangeText("1,99", 3);
    expect(outcome).toEqual({ kind: "invalid", error: "Band 99 is out of range (1-3)." });
  });

  it("rejects a range that crosses past the band count", () => {
    const outcome = deriveKeptBandSelectionFromTypedRangeText("2-9", 3);
    expect(outcome).toEqual({ kind: "invalid", error: "Band 9 is out of range (1-3)." });
  });
});

describe("describeTypedRangeFieldErrorOrNull", () => {
  it("returns null for valid text and for the neutral empty field", () => {
    expect(describeTypedRangeFieldErrorOrNull("1-2", 3)).toBeNull();
    expect(describeTypedRangeFieldErrorOrNull("", 3)).toBeNull();
  });

  it("returns the parse error for invalid text", () => {
    expect(describeTypedRangeFieldErrorOrNull("0", 3)).toMatch(/not a valid band number/i);
  });
});

describe("SUBSET_BANDS_RANGE_FIELD_HINT", () => {
  it("reads the locked CT-283 description", () => {
    expect(SUBSET_BANDS_RANGE_FIELD_HINT).toBe(
      "Use commas to list bands and dashes for ranges (e.g. 1,3,5 or 1-5,10)",
    );
  });
});
