// CT-219 scratch re-verify (NEVER COMMITTED): Spatial Filter at reference
// scale, measured honestly. The T13 harness raced the busy overlay's 50 ms
// anti-flash delay (applyMs 399 was bogus) and hovered for the readout while
// the worker was still computing. This run waits for the overlay to APPEAR
// and then CLEAR before measuring anything, then probes the pixel readout
// with a long budget to decide whether the result panel's readout is dead
// (the mount-once pointer-handler hypothesis) or was merely busy.
import { expect, test } from "@playwright/test";

import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import { nonClearPixelFraction, summarizeCanvasPixels } from "./support/canvas-pixels";
import { openOperation, operationPanel } from "./support/operations";
import { panelCanvas, panelGrid, selectPanel } from "./support/panels";
import {
  REFERENCE_DIMENSIONS,
  openReferenceStackViaGroupedBandFiles,
  readRendererPeakWorkingSetMb,
  readReportedPixelNear,
  readVisibleToastTexts,
  recordAuditResult,
  startUiHeartbeat,
  stopUiHeartbeatAndReadMaxGapMs,
} from "./scale-audit.support";

const LOAD_BUDGET_MS = 8 * 60_000;
const WORKER_BUDGET_MS = 10 * 60_000;

let launched: LaunchedApp;

test.beforeEach(async () => {
  test.setTimeout(25 * 60_000);
  launched = await launchToolboxApp();
});

test.afterEach(async () => {
  try {
    await closeToolboxApp(launched);
  } catch {
    await launched.app.close().catch(() => undefined);
  }
});

test("T13b spatial filter honest timing + readout-liveness probe", async () => {
  await openReferenceStackViaGroupedBandFiles(launched.window, LOAD_BUDGET_MS);
  await selectPanel(launched.window, 1);
  await openOperation(launched.window, "Spatial Filter");

  const overlay = panelGrid(launched.window).locator('[role="status"]:has(svg.animate-spin)');
  await startUiHeartbeat(launched.window);
  const startedAt = Date.now();
  await operationPanel(launched.window, "Spatial Filter")
    .getByRole("button", { name: "Apply", exact: true })
    .click();

  // Busy feedback must actually appear (this is itself part of the verdict:
  // long compute WITH progress feedback is a pass; without it, a finding).
  let overlayAppeared = true;
  let overlayAppearedAfterMs = -1;
  try {
    await expect(overlay.first()).toBeVisible({ timeout: 15_000 });
    overlayAppearedAfterMs = Date.now() - startedAt;
  } catch {
    overlayAppeared = false;
  }
  await expect(overlay).toHaveCount(0, { timeout: WORKER_BUDGET_MS });
  const applyMs = Date.now() - startedAt;
  const maxUiGapMs = await stopUiHeartbeatAndReadMaxGapMs(launched.window);

  const toasts = await readVisibleToastTexts(launched.window);
  const failureToast = toasts.find((t) => t.toLowerCase().includes("failed"));

  const fraction = await nonClearPixelFraction(
    await summarizeCanvasPixels(panelCanvas(launched.window, 2)),
  );

  // Readout-liveness probe on the RESULT panel, long after completion.
  const resultReadout = await readReportedPixelNear(
    launched.window,
    2,
    { x: 2450, y: 1850 },
    REFERENCE_DIMENSIONS,
  ).catch((error) => ({ error: String(error) }));

  // Control: the SOURCE panel readout must still work in the same app state,
  // so a dead result-panel readout cannot be blamed on the harness hover.
  await selectPanel(launched.window, 1);
  const sourceReadout = await readReportedPixelNear(
    launched.window,
    1,
    { x: 2450, y: 1850 },
    REFERENCE_DIMENSIONS,
  ).catch((error) => ({ error: String(error) }));

  recordAuditResult({
    area: "operation: Spatial Filter (lowpass default, worker-backed, CT-219a fix verify, honest timing)",
    verdict: failureToast
      ? "finding: hard failure"
      : maxUiGapMs > 5000
        ? "finding: UI freeze > 5s"
        : "pass",
    overlayAppeared,
    overlayAppearedAfterMs,
    applyMs,
    maxUiGapMs,
    failureToast: failureToast ?? null,
    resultCanvasNonClearFraction: fraction,
    resultPanelReadout: resultReadout,
    sourcePanelReadoutControl: sourceReadout,
    rendererMb: await readRendererPeakWorkingSetMb(launched.app),
  });
});
