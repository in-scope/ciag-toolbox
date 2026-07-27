// Pure composition of the per-run trace folder label and per-trace zip file
// names (CT-228). Kept free of Playwright and filesystem imports so the logic
// is trivially testable; the vitest config only includes src/**, so these are
// proven by the double-run trace verification instead of a unit test.

const MAX_FILE_NAME_LABEL_LENGTH = 80;

export function sanitizeForFileName(rawLabel: string): string {
  return rawLabel
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_FILE_NAME_LABEL_LENGTH);
}

export function formatTraceRunTimestamp(processStartedAt: Date): string {
  return processStartedAt.toISOString().replace(/\.(\d+)Z$/, "-$1").replace(/:/g, "-");
}

// The run folder combines the operator-supplied MSI_E2E_TRACE_LABEL (e.g. a
// story id) with the test-runner process's start timestamp, so successive runs
// always land in distinct folders even under the same label.
export function composeTraceRunFolderLabel(
  configuredLabel: string | undefined,
  processStartedAt: Date,
): string {
  const timestamp = formatTraceRunTimestamp(processStartedAt);
  const sanitizedConfiguredLabel = sanitizeForFileName(configuredLabel ?? "");
  if (sanitizedConfiguredLabel.length === 0) return timestamp;
  return `${sanitizedConfiguredLabel}-${timestamp}`;
}

// The sequence keeps zips distinct when one test launches the app repeatedly.
export function composeTraceZipFileName(testTitleLabel: string, sequence: number): string {
  const sanitizedTitle = sanitizeForFileName(testTitleLabel);
  const baseName = sanitizedTitle.length > 0 ? sanitizedTitle : "trace";
  return `${baseName}-${sequence}.zip`;
}
