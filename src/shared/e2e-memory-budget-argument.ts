// CT-260 e2e test surface (MSI_E2E only, like the dialog stubs): a lowered
// renderer raster-memory budget makes memory refusals reproducible with the
// tiny committed fixtures instead of needing a multi-gigabyte stack. Main
// turns the environment variable into a preload additional argument; the
// preload parses it back and exposes it on window.toolboxE2E. A production
// launch never passes --msi-e2e-test-mode, so the bridge (and with it the
// override) does not exist there.

export const E2E_MEMORY_BUDGET_ENVIRONMENT_VARIABLE = "MSI_E2E_MEMORY_BUDGET_BYTES";

export const E2E_MEMORY_BUDGET_PRELOAD_ARGUMENT_PREFIX = "--msi-e2e-memory-budget-bytes=";

export function buildMemoryBudgetPreloadArgumentOrNull(
  rawBudgetBytes: string | undefined,
): string | null {
  const budgetBytes = parseWholePositiveByteCountOrNull(rawBudgetBytes);
  if (budgetBytes === null) return null;
  return `${E2E_MEMORY_BUDGET_PRELOAD_ARGUMENT_PREFIX}${budgetBytes}`;
}

export function readMemoryBudgetOverrideBytesFromArguments(
  argumentList: ReadonlyArray<string>,
): number | null {
  const argument = argumentList.find((candidate) =>
    candidate.startsWith(E2E_MEMORY_BUDGET_PRELOAD_ARGUMENT_PREFIX),
  );
  if (argument === undefined) return null;
  return parseWholePositiveByteCountOrNull(
    argument.slice(E2E_MEMORY_BUDGET_PRELOAD_ARGUMENT_PREFIX.length),
  );
}

function parseWholePositiveByteCountOrNull(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
