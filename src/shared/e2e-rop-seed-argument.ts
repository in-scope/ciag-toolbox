// CT-309 e2e test surface (MSI_E2E only, CT-260 pattern): a forced ROP seed
// makes every "New projection" press reproducible against the reference output
// pinned in the fixture manifest. Main turns the environment variable into a
// preload additional argument; the preload parses it back and exposes it on
// window.toolboxE2E. A production launch never passes --msi-e2e-test-mode, so
// the bridge (and with it the override) does not exist there.

export const E2E_ROP_SEED_ENVIRONMENT_VARIABLE = "MSI_E2E_ROP_FORCED_SEED";

export const E2E_ROP_SEED_PRELOAD_ARGUMENT_PREFIX = "--msi-e2e-rop-forced-seed=";

export function buildRopSeedPreloadArgumentOrNull(rawSeed: string | undefined): string | null {
  const seed = parseWholeNonNegativeSeedOrNull(rawSeed);
  if (seed === null) return null;
  return `${E2E_ROP_SEED_PRELOAD_ARGUMENT_PREFIX}${seed}`;
}

export function readRopSeedOverrideFromArguments(
  argumentList: ReadonlyArray<string>,
): number | null {
  const argument = argumentList.find((candidate) =>
    candidate.startsWith(E2E_ROP_SEED_PRELOAD_ARGUMENT_PREFIX),
  );
  if (argument === undefined) return null;
  return parseWholeNonNegativeSeedOrNull(
    argument.slice(E2E_ROP_SEED_PRELOAD_ARGUMENT_PREFIX.length),
  );
}

function parseWholeNonNegativeSeedOrNull(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
