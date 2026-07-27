import type { UserScriptResultKind } from "./worker-protocol";

// CT-216/CT-241: the wall-clock budget depends on what the run produces AND on
// how much cube data it moves. The timer starts when the worker spawns, so it
// covers streaming the spooled cube to the worker's stdin, numpy's rebuild of
// the array, the user code, and (for cube runs) writing the result spool - all
// proportional to cube size. The fixed limits that fit the 3 GB reference
// scale starved the 5+ GB scale10 runs, so each run gets its base budget plus
// a transfer allowance per gibibyte per direction the cube crosses (in for
// value runs; in and out for cube runs).

export const USER_SCRIPT_WALL_CLOCK_TIMEOUT_MS = 30_000;
export const USER_SCRIPT_CUBE_WALL_CLOCK_TIMEOUT_MS = 120_000;
export const USER_SCRIPT_TRANSFER_TIMEOUT_MS_PER_GIB = 60_000;

const BYTES_PER_GIB = 1024 ** 3;

export function wallClockTimeoutMsForUserScriptRun(
  resultKind: UserScriptResultKind,
  cubeByteLength: number,
): number {
  return baseTimeoutMsFor(resultKind) + transferAllowanceMsFor(resultKind, cubeByteLength);
}

function baseTimeoutMsFor(resultKind: UserScriptResultKind): number {
  return resultKind === "cube"
    ? USER_SCRIPT_CUBE_WALL_CLOCK_TIMEOUT_MS
    : USER_SCRIPT_WALL_CLOCK_TIMEOUT_MS;
}

function transferAllowanceMsFor(resultKind: UserScriptResultKind, cubeByteLength: number): number {
  const cubeCrossingCount = resultKind === "cube" ? 2 : 1;
  const gibibytes = Math.max(0, cubeByteLength) / BYTES_PER_GIB;
  return Math.round(gibibytes * cubeCrossingCount * USER_SCRIPT_TRANSFER_TIMEOUT_MS_PER_GIB);
}
