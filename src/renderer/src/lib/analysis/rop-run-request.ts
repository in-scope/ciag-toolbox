// CT-309: seeds and params for the built-in rop.py runs. Every "New
// projection" press draws a FRESH seed (so presses explore the projection
// space) and passes it through params, which is what makes a kept stack's
// History entry reproducible. The MSI_E2E bridge can force a fixed seed so a
// spec's press matches the reference output pinned in the fixture manifest;
// the bridge only exists under --msi-e2e-test-mode, never in production.

export const ROP_SEED_EXCLUSIVE_UPPER_BOUND = 2 ** 32;

export function drawRopSeed(
  forcedSeed: number | null,
  drawRandomUnitInterval: () => number = Math.random,
): number {
  if (forcedSeed !== null) return forcedSeed;
  return Math.floor(drawRandomUnitInterval() * ROP_SEED_EXCLUSIVE_UPPER_BOUND);
}

export function buildRopExecuteParams(seed: number): Record<string, unknown> {
  return { seed, count: 1 };
}

interface WindowCarryingRopSeedOverride {
  readonly toolboxE2E?: { readonly ropForcedSeedOverride?: number | null };
}

export function readForcedRopSeedFromE2eBridgeOrNull(
  windowLike: unknown = globalThis.window,
): number | null {
  const override = (windowLike as WindowCarryingRopSeedOverride)?.toolboxE2E
    ?.ropForcedSeedOverride;
  return typeof override === "number" && Number.isSafeInteger(override) ? override : null;
}
