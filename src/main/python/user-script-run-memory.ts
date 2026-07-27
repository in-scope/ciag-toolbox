import { OPERATION_MEMORY_REFUSAL_MESSAGE } from "../../shared/memory-refusal-copy";
import type {
  UserScriptRunCubeDescriptor,
  UserScriptRunResultKind,
} from "../../shared/chunked-user-script-run-protocol";

// CT-241: preflight for the Python worker's memory, checked at BEGIN (before
// any cube bytes move). The worker rebuilds the streamed cube as the raw stdin
// bytes plus numpy's copied array (2x the float32 cube), and a cube-result run
// holds the user script's output cube on top of that (3x). A run whose peak
// cannot fit in physical memory would page the machine to a standstill and die
// on a numpy MemoryError whose raw allocator text violates the locked error
// vocabulary, so it is refused up front with the CT-239 refusal copy instead.
// Measured basis: the 10 GB scale10 capture is a 20 GB float32 cube, and a
// value run over it (40 GB worker peak) cannot fit a 32 GB machine.

const FLOAT32_BYTES_PER_SAMPLE = 4;

export const VALUE_RUN_WORKER_MEMORY_CUBE_MULTIPLIER = 2;
export const CUBE_RUN_WORKER_MEMORY_CUBE_MULTIPLIER = 3;

export function estimateUserScriptRunWorkerMemoryBytes(
  cube: UserScriptRunCubeDescriptor,
  resultKind: UserScriptRunResultKind,
): number {
  return float32CubeByteLengthOf(cube) * workerMemoryCubeMultiplierFor(resultKind);
}

export function describeUserScriptRunMemoryRefusalOrNull(
  cube: UserScriptRunCubeDescriptor,
  resultKind: UserScriptRunResultKind,
  totalSystemMemoryBytes: number,
): string | null {
  const workerBytes = estimateUserScriptRunWorkerMemoryBytes(cube, resultKind);
  return workerBytes > totalSystemMemoryBytes ? OPERATION_MEMORY_REFUSAL_MESSAGE : null;
}

export function float32CubeByteLengthOf(cube: UserScriptRunCubeDescriptor): number {
  return cube.bandCount * cube.height * cube.width * FLOAT32_BYTES_PER_SAMPLE;
}

function workerMemoryCubeMultiplierFor(resultKind: UserScriptRunResultKind): number {
  return resultKind === "cube"
    ? CUBE_RUN_WORKER_MEMORY_CUBE_MULTIPLIER
    : VALUE_RUN_WORKER_MEMORY_CUBE_MULTIPLIER;
}
