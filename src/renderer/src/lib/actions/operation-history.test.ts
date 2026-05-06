import { describe, expect, it } from "vitest";

import {
  EMPTY_OPERATION_HISTORY,
  appendOperationHistoryEntry,
  formatOperationHistoryParameterValuesAsInlineText,
  formatOperationHistoryTimestampForDisplay,
} from "./operation-history";

describe("appendOperationHistoryEntry", () => {
  it("appends a new entry with the given draft fields and timestamp", () => {
    const next = appendOperationHistoryEntry(
      EMPTY_OPERATION_HISTORY,
      {
        actionId: "bit-shift",
        actionLabel: "Bit Shift",
        appliedLabel: "Bit shift +4",
        parameterValues: { shiftAmount: 4 },
      },
      1_700_000_000_000,
    );
    expect(next).toHaveLength(1);
    expect(next[0]).toEqual({
      actionId: "bit-shift",
      actionLabel: "Bit Shift",
      appliedLabel: "Bit shift +4",
      parameterValues: { shiftAmount: 4 },
      timestampMs: 1_700_000_000_000,
    });
  });

  it("does not mutate the input history", () => {
    const initial = EMPTY_OPERATION_HISTORY;
    appendOperationHistoryEntry(
      initial,
      {
        actionId: "x",
        actionLabel: "X",
        appliedLabel: "X applied",
        parameterValues: {},
      },
      1,
    );
    expect(initial).toHaveLength(0);
  });

  it("preserves earlier entries when appending another", () => {
    const first = appendOperationHistoryEntry(
      EMPTY_OPERATION_HISTORY,
      { actionId: "a", actionLabel: "A", appliedLabel: "A", parameterValues: {} },
      10,
    );
    const second = appendOperationHistoryEntry(
      first,
      { actionId: "b", actionLabel: "B", appliedLabel: "B", parameterValues: {} },
      20,
    );
    expect(second.map((entry) => entry.actionId)).toEqual(["a", "b"]);
  });
});

describe("formatOperationHistoryParameterValuesAsInlineText", () => {
  it("returns an empty string when given an empty record", () => {
    expect(formatOperationHistoryParameterValuesAsInlineText({})).toBe("");
  });

  it("formats numeric values with their schema id", () => {
    expect(
      formatOperationHistoryParameterValuesAsInlineText({ shiftAmount: 4 }),
    ).toBe("shiftAmount: 4");
  });

  it("sorts keys alphabetically and joins with commas", () => {
    expect(
      formatOperationHistoryParameterValuesAsInlineText({ z: 1, a: "yes" }),
    ).toBe("a: yes, z: 1");
  });

  it("formats boolean values as true / false", () => {
    expect(
      formatOperationHistoryParameterValuesAsInlineText({ enabled: true }),
    ).toBe("enabled: true");
  });
});

describe("formatOperationHistoryTimestampForDisplay", () => {
  it("returns an HH:MM:SS string", () => {
    const formatted = formatOperationHistoryTimestampForDisplay(
      new Date(2026, 4, 6, 13, 45, 7).getTime(),
    );
    expect(formatted).toBe("13:45:07");
  });

  it("returns an empty string for a non-finite input", () => {
    expect(formatOperationHistoryTimestampForDisplay(Number.NaN)).toBe("");
  });
});
