import { describe, expect, it } from "vitest";

import {
  buildMemoryBudgetPreloadArgumentOrNull,
  E2E_MEMORY_BUDGET_PRELOAD_ARGUMENT_PREFIX,
  readMemoryBudgetOverrideBytesFromArguments,
} from "./e2e-memory-budget-argument";

describe("buildMemoryBudgetPreloadArgumentOrNull", () => {
  it("builds the prefixed argument for a whole positive byte count", () => {
    expect(buildMemoryBudgetPreloadArgumentOrNull("1234")).toBe(
      `${E2E_MEMORY_BUDGET_PRELOAD_ARGUMENT_PREFIX}1234`,
    );
  });

  it.each([
    ["an unset variable", undefined],
    ["an empty string", ""],
    ["a non-numeric string", "lots"],
    ["a negative number", "-5"],
    ["a fractional number", "1.5"],
    ["zero", "0"],
  ])("returns null for %s", (_label, raw) => {
    expect(buildMemoryBudgetPreloadArgumentOrNull(raw)).toBeNull();
  });
});

describe("readMemoryBudgetOverrideBytesFromArguments", () => {
  it("reads the byte count back from an argument list", () => {
    const argumentList = [
      "--msi-e2e-test-mode",
      `${E2E_MEMORY_BUDGET_PRELOAD_ARGUMENT_PREFIX}5000`,
    ];
    expect(readMemoryBudgetOverrideBytesFromArguments(argumentList)).toBe(5000);
  });

  it("round-trips what the builder produced", () => {
    const argument = buildMemoryBudgetPreloadArgumentOrNull("482");
    expect(readMemoryBudgetOverrideBytesFromArguments([argument!])).toBe(482);
  });

  it("returns null when no budget argument is present", () => {
    expect(readMemoryBudgetOverrideBytesFromArguments(["--msi-e2e-test-mode"])).toBeNull();
  });

  it("returns null for a malformed budget argument", () => {
    expect(
      readMemoryBudgetOverrideBytesFromArguments([
        `${E2E_MEMORY_BUDGET_PRELOAD_ARGUMENT_PREFIX}not-a-number`,
      ]),
    ).toBeNull();
  });
});
