import { describe, expect, it } from "vitest";

import {
  USER_SCRIPT_CUBE_WALL_CLOCK_TIMEOUT_MS,
  USER_SCRIPT_TRANSFER_TIMEOUT_MS_PER_GIB,
  USER_SCRIPT_WALL_CLOCK_TIMEOUT_MS,
  wallClockTimeoutMsForUserScriptRun,
} from "./user-script-timeouts";

const ONE_GIB = 1024 ** 3;

describe("wallClockTimeoutMsForUserScriptRun", () => {
  it("keeps the original 30000 ms base for cube-free 'value' runs (band weighting/selection)", () => {
    expect(wallClockTimeoutMsForUserScriptRun("value", 0)).toBe(30_000);
    expect(USER_SCRIPT_WALL_CLOCK_TIMEOUT_MS).toBe(30_000);
  });

  it("keeps the 120000 ms whole-stack base for cube-free 'cube' runs", () => {
    expect(wallClockTimeoutMsForUserScriptRun("cube", 0)).toBe(120_000);
    expect(USER_SCRIPT_CUBE_WALL_CLOCK_TIMEOUT_MS).toBe(120_000);
  });

  it("adds one transfer allowance per gibibyte for a value run (the cube crosses once)", () => {
    expect(wallClockTimeoutMsForUserScriptRun("value", 3 * ONE_GIB)).toBe(
      USER_SCRIPT_WALL_CLOCK_TIMEOUT_MS + 3 * USER_SCRIPT_TRANSFER_TIMEOUT_MS_PER_GIB,
    );
  });

  it("adds two transfer allowances per gibibyte for a cube run (the cube crosses in and out)", () => {
    expect(wallClockTimeoutMsForUserScriptRun("cube", 3 * ONE_GIB)).toBe(
      USER_SCRIPT_CUBE_WALL_CLOCK_TIMEOUT_MS + 6 * USER_SCRIPT_TRANSFER_TIMEOUT_MS_PER_GIB,
    );
  });

  it("scales fractionally and never subtracts for an empty descriptor", () => {
    expect(wallClockTimeoutMsForUserScriptRun("value", ONE_GIB / 2)).toBe(
      USER_SCRIPT_WALL_CLOCK_TIMEOUT_MS + USER_SCRIPT_TRANSFER_TIMEOUT_MS_PER_GIB / 2,
    );
    expect(wallClockTimeoutMsForUserScriptRun("value", -1)).toBe(USER_SCRIPT_WALL_CLOCK_TIMEOUT_MS);
  });
});
