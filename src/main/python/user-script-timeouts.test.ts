import { describe, expect, it } from "vitest";

import {
  USER_SCRIPT_CUBE_WALL_CLOCK_TIMEOUT_MS,
  USER_SCRIPT_WALL_CLOCK_TIMEOUT_MS,
  wallClockTimeoutMsForUserScriptResultKind,
} from "./user-script-timeouts";

describe("wallClockTimeoutMsForUserScriptResultKind", () => {
  it("keeps the original 30000 ms limit for 'value' runs (band weighting/selection)", () => {
    expect(wallClockTimeoutMsForUserScriptResultKind("value")).toBe(30_000);
    expect(USER_SCRIPT_WALL_CLOCK_TIMEOUT_MS).toBe(30_000);
  });

  it("gives 'cube' runs the 120000 ms whole-stack transform budget", () => {
    expect(wallClockTimeoutMsForUserScriptResultKind("cube")).toBe(120_000);
    expect(USER_SCRIPT_CUBE_WALL_CLOCK_TIMEOUT_MS).toBe(120_000);
  });
});
