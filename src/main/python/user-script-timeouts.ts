import type { UserScriptResultKind } from "./worker-protocol";

// CT-216: the wall-clock budget depends on what the run produces. A 'value' run
// (band weighting, band selection) keeps the original 30 s limit; a 'cube' run
// transforms the whole stack, so it gets 120 s before the kill switch fires.

export const USER_SCRIPT_WALL_CLOCK_TIMEOUT_MS = 30_000;
export const USER_SCRIPT_CUBE_WALL_CLOCK_TIMEOUT_MS = 120_000;

export function wallClockTimeoutMsForUserScriptResultKind(
  resultKind: UserScriptResultKind,
): number {
  return resultKind === "cube"
    ? USER_SCRIPT_CUBE_WALL_CLOCK_TIMEOUT_MS
    : USER_SCRIPT_WALL_CLOCK_TIMEOUT_MS;
}
