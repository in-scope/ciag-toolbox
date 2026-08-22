import { appendFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { closeToolboxApp, launchToolboxApp, type LaunchedApp } from "./support/launch-app";
import {
  expectThresholdEditorReady,
  openOperation,
  selectPanel,
  thresholdBoundField,
} from "./support/page-objects";
import {
  AUDIT_DIRECTORY,
  openCaptureFromDisk,
  readVisibleToastTexts,
  REFERENCE_STACK_PATH,
  startUiHeartbeat,
  stopUiHeartbeatAndReadMaxGapMs,
} from "./scale-audit.support";

// CT-219d at-scale verification (SCRATCH, NEVER COMMITTED, per the CT-219
// precedent): Threshold's Auto button on the 8000x6000x16 uint16 reference
// stack must populate the bound fields (it previously swallowed a 6.1 GB
// allocation failure and left them empty forever), show busy progress, and
// keep the UI responsive (no >5 s freeze).
//
// Analytic oracle (confirmed by the full-scale vitest scratch run): band 1
// spans 1000..1198, which crosses exactly one 256-wide histogram bin edge at
// 1024, so its Otsu bounds are [1024, 65535].

const THRESHOLD = "Threshold";
const EXPECTED_BAND_1_LOWER = "1024";
const EXPECTED_UPPER = "65535";
const AUTO_BUDGET_MS = 120_000;

let launched: LaunchedApp;

test.beforeEach(async () => {
  test.setTimeout(15 * 60_000);
  launched = await launchToolboxApp();
});

test.afterEach(async () => {
  try {
    await closeToolboxApp(launched);
  } catch {
    await launched.app.close().catch(() => undefined);
  }
});

function logVerifyEvidence(entry: Record<string, unknown>): void {
  const line = JSON.stringify({ recordedAt: new Date().toISOString(), ...entry });
  appendFileSync(join(AUDIT_DIRECTORY, "ct219d-verify.log"), `${line}\n`);
  console.log(`CT219D ${line}`);
}

// The CT-220/221 percentage bar: poll for any determinate progressbar while
// the Auto derivation runs (mirrors scale-audit.support's private watcher).
function watchForProgressBar(): { sawBar: () => boolean; stop: () => void } {
  let sawBar = false;
  let stopped = false;
  const poll = async (): Promise<void> => {
    while (!stopped && !sawBar) {
      sawBar = await launched.window
        .locator('[role="progressbar"]')
        .count()
        .then((count) => count > 0)
        .catch(() => false);
      await new Promise((resolveTimer) => setTimeout(resolveTimer, 100));
    }
  };
  void poll();
  return { sawBar: () => sawBar, stop: () => { stopped = true; } };
}

test("Otsu Auto populates cutoffs at reference scale with busy progress and no freeze", async () => {
  const loadMs = await openCaptureFromDisk(launched.window, REFERENCE_STACK_PATH, 5 * 60_000);
  await selectPanel(launched.window, 1);
  await openOperation(launched.window, THRESHOLD);
  await expectThresholdEditorReady(launched.window);

  await startUiHeartbeat(launched.window);
  const progressWatch = watchForProgressBar();
  const startedAt = Date.now();
  await launched.window.getByRole("button", { name: "Auto", exact: true }).click();
  await expect(thresholdBoundField(launched.window, "Lower")).toHaveValue(EXPECTED_BAND_1_LOWER, {
    timeout: AUTO_BUDGET_MS,
  });
  const autoMs = Date.now() - startedAt;
  progressWatch.stop();
  const maxUiGapMs = await stopUiHeartbeatAndReadMaxGapMs(launched.window);

  await expect(thresholdBoundField(launched.window, "Upper")).toHaveValue(EXPECTED_UPPER);
  const toasts = await readVisibleToastTexts(launched.window);
  logVerifyEvidence({
    loadMs,
    autoMs,
    maxUiGapMs,
    sawDeterminateProgressBar: progressWatch.sawBar(),
    toasts,
  });
  expect(toasts.filter((text) => text.toLowerCase().includes("failed"))).toEqual([]);
  expect(progressWatch.sawBar()).toBe(true);
  expect(maxUiGapMs).toBeLessThan(5000);
});
