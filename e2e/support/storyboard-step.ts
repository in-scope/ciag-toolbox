import { test } from "@playwright/test";
import type { Page } from "@playwright/test";

// Wraps a shared support-helper body in test.step AND mirrors the label into
// the saved Electron trace as a tracing group. The manually collected context
// trace (launch-app.ts) never sees test.step entries - those live in the
// runner's own trace, which tracing.stop does not save - so without the group
// the trace viewer's action list would read as raw clicks instead of a
// storyboard of named phases (CT-228). Pass null for tracedPage only when the
// step starts or stops tracing itself (launch/close).
export async function runAsStoryboardStep<T>(
  tracedPage: Page | null,
  label: string,
  body: () => Promise<T>,
): Promise<T> {
  if (!isInsideRunningTest()) return body();
  return test.step(label, () => runInsideTraceGroup(tracedPage, label, body));
}

async function runInsideTraceGroup<T>(
  tracedPage: Page | null,
  label: string,
  body: () => Promise<T>,
): Promise<T> {
  if (tracedPage === null || !tracingIsEnabled()) return body();
  const tracing = tracedPage.context().tracing;
  await tracing.group(label);
  try {
    return await body();
  } finally {
    await tracing.groupEnd().catch(() => undefined);
  }
}

// Tracing is opt-OUT (CT-228): every app launched via launchToolboxApp records
// a trace unless MSI_E2E_TRACE=0. Lives here so the storyboard wrapper can
// skip tracing groups when tracing is off (tracing.group throws when no trace
// is being recorded); launch-app.ts imports it for the start/stop decision.
export function tracingIsEnabled(): boolean {
  return process.env["MSI_E2E_TRACE"] !== "0";
}

function isInsideRunningTest(): boolean {
  try {
    test.info();
    return true;
  } catch {
    return false;
  }
}
