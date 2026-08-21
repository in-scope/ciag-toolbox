// CT-268: every long operation has a Stop button. The busy overlay of a
// stoppable apply offers Stop; clicking it aborts the run at the next chunk
// boundary, opens no result panel, records nothing in History, and shows the
// transient "Operation stopped" toast. The proof runs PCA on the Anna
// benchmark (1000 x 2000 x 49-band uint16, generated on demand into the
// gitignored .scale-audit/), stops it mid-progress-bar, then runs the same
// PCA to completion to show a stopped panel is not poisoned.
//
// Run locally: dev server first (pnpm dev), then
//   MSI_E2E_TRACE_LABEL=CT-268 pnpm e2e ct268-stop-operation.spec.ts
import { expect, test } from "@playwright/test";

import {
  ANNA_BENCHMARK_TIFF_PATH,
  ensureAnnaBenchmarkFixtureExists,
} from "./anna-benchmark.support";
import { applyOperationWithBudget, openScale10SingleFile } from "./scale10.support";
import { historyEntryCount } from "./support/history-panel";
import { closeToolboxApp, launchToolboxApp, type LaunchedApp } from "./support/launch-app";
import { readMetadata } from "./support/metadata-panel";
import { openOperation, operationPanel } from "./support/operations";
import { panelGrid, selectPanel } from "./support/panels";
import { runAsStoryboardStep } from "./support/storyboard-step";

const SOURCE_PANEL = 1;
const RESULT_PANEL = 2;

const OPEN_BUDGET_MS = 4 * 60_000;
// CT-270 has not landed yet, so the completion run gets a generous pre-perf
// budget; the stop itself lands within one chunk boundary (milliseconds).
const PCA_COMPLETION_BUDGET_MS = 10 * 60_000;
const TEST_TIMEOUT_MS = 25 * 60_000;

const OPERATION_STOPPED_TOAST_TEXT = "Operation stopped";
const PCA_DEFAULT_COMPONENT_COUNT = 10;

let launched: LaunchedApp;

test.beforeAll(() => {
  ensureAnnaBenchmarkFixtureExists();
});

test.beforeEach(async () => {
  launched = await launchToolboxApp();
});

test.afterEach(async () => {
  if (!launched) return;
  try {
    await closeToolboxApp(launched);
  } catch {
    await launched.app.close().catch(() => undefined);
  }
});

test("stopping PCA mid-run opens no panel and keeps History clean, then PCA still completes", async () => {
  test.setTimeout(TEST_TIMEOUT_MS);
  await openScale10SingleFile(launched.window, ANNA_BENCHMARK_TIFF_PATH, OPEN_BUDGET_MS);
  await selectPanel(launched.window, SOURCE_PANEL);
  const historyEntriesBefore = await historyEntryCount(launched.window);

  await startPcaAndStopItMidRun();
  await verifyStoppedRunLeftNoTrace(historyEntriesBefore);

  await runPcaToCompletionAndVerifyTheResultPanel();
});

async function startPcaAndStopItMidRun(): Promise<void> {
  await runAsStoryboardStep(launched.window, "Start PCA and click Stop mid-run", async () => {
    await openOperation(launched.window, "PCA");
    await operationPanel(launched.window, "PCA")
      .getByRole("button", { name: "Apply", exact: true })
      .click();
    await expectTheProgressBarIsMidRun();
    await clickStopOnTheResultPanelBusyOverlay();
    await expect(
      launched.window.locator("[data-sonner-toast]", { hasText: OPERATION_STOPPED_TOAST_TEXT }),
    ).toBeVisible({ timeout: 30_000 });
  });
}

async function expectTheProgressBarIsMidRun(): Promise<void> {
  await expect(
    launched.window.locator('[role="progressbar"][aria-valuenow]').first(),
  ).toBeVisible({ timeout: 60_000 });
}

async function clickStopOnTheResultPanelBusyOverlay(): Promise<void> {
  await panelGrid(launched.window)
    .locator('[role="status"]')
    .getByRole("button", { name: "Stop", exact: true })
    .click();
}

// An empty grid cell still renders its (blank) canvas element, so "no result
// panel opened" is asserted on the per-panel close button, which only renders
// for a cell that actually holds an image.
async function verifyStoppedRunLeftNoTrace(historyEntriesBefore: number): Promise<void> {
  await runAsStoryboardStep(launched.window, "Verify no panel opened and History is unchanged", async () => {
    await expect(panelGrid(launched.window).locator('[role="status"]')).toHaveCount(0, {
      timeout: 30_000,
    });
    await expect(
      launched.window.getByRole("button", { name: `Close panel ${RESULT_PANEL}`, exact: true }),
    ).toHaveCount(0);
    await selectPanel(launched.window, SOURCE_PANEL);
    expect(await historyEntryCount(launched.window)).toBe(historyEntriesBefore);
  });
}

async function runPcaToCompletionAndVerifyTheResultPanel(): Promise<void> {
  await selectPanel(launched.window, SOURCE_PANEL);
  await openOperation(launched.window, "PCA");
  await applyOperationWithBudget(launched.window, "PCA", PCA_COMPLETION_BUDGET_MS);
  await runAsStoryboardStep(launched.window, "Verify the completed PCA panel", async () => {
    await expect(
      launched.window.getByRole("button", { name: `Close panel ${RESULT_PANEL}`, exact: true }),
    ).toBeVisible();
    await selectPanel(launched.window, RESULT_PANEL);
    const metadata = await readMetadata(launched.window);
    expect(metadata.bandCount).toBe(String(PCA_DEFAULT_COMPONENT_COUNT));
  });
}
