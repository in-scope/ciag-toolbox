// CT-269: applies stay isolated while another operation runs. Every apply
// reserves its own result panel, so a second apply started while the first is
// in flight lands in a DISTINCT panel (the blend Wallace saw came from both
// applies finding the same "empty" cell). Closing a run's reserved target
// panel cancels that run through the CT-268 abort token and the panel stays
// closed; closing a run's SOURCE panel is refused with a toast naming the
// operation. Proven at the Anna benchmark (1000 x 2000 x 49-band uint16,
// generated on demand into the gitignored .scale-audit/).
//
// Run locally: dev server first (pnpm dev), then
//   MSI_E2E_TRACE_LABEL=CT-269 pnpm e2e ct269-apply-isolation.spec.ts
import { expect, test } from "@playwright/test";

import {
  ANNA_BENCHMARK_DIMENSIONS,
  ANNA_BENCHMARK_TIFF_PATH,
  annaBenchmarkValue,
  ensureAnnaBenchmarkFixtureExists,
} from "./anna-benchmark.support";
import { openScale10SingleFile, readReportedPixelNear } from "./scale10.support";
import { historyEntryCount } from "./support/history-panel";
import { closeToolboxApp, launchToolboxApp, type LaunchedApp } from "./support/launch-app";
import { readMetadata } from "./support/metadata-panel";
import { openOperation, operationPanel } from "./support/operations";
import { panelGrid, selectPanel } from "./support/panels";
import { runAsStoryboardStep } from "./support/storyboard-step";

const SOURCE_PANEL = 1;
const ICA_RESULT_PANEL = 2;
const INVERT_RESULT_PANEL = 3;

const OPEN_BUDGET_MS = 4 * 60_000;
// CT-270 has not landed yet, so ICA completion gets a generous pre-perf budget.
const ICA_COMPLETION_BUDGET_MS = 15 * 60_000;
const TEST_TIMEOUT_MS = 25 * 60_000;

const ICA_DEFAULT_COMPONENT_COUNT = 10;
const UINT16_MAX = 65_535;
const OPERATION_STOPPED_TOAST_TEXT = "Operation stopped";
const CLOSE_SOURCE_REFUSED_TOAST_TEXT = "Cannot close panel 1 while ICA is running on it";

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

test("an Invert applied while ICA runs lands in its own panel with correct content", async () => {
  test.setTimeout(TEST_TIMEOUT_MS);
  await openScale10SingleFile(launched.window, ANNA_BENCHMARK_TIFF_PATH, OPEN_BUDGET_MS);
  await selectPanel(launched.window, SOURCE_PANEL);

  await startIcaOnTheSourcePanel();
  await applyInvertOnTheSameSourceWhileIcaRuns();
  await waitForBothOperationsToComplete();
  await verifyTheTwoResultPanelsAreDistinctAndCorrect();
});

async function startIcaOnTheSourcePanel(): Promise<void> {
  await runAsStoryboardStep(launched.window, "Start ICA on the source panel", async () => {
    await openOperation(launched.window, "ICA");
    await operationPanel(launched.window, "ICA")
      .getByRole("button", { name: "Apply", exact: true })
      .click();
    await expectAProgressBarIsMidRun();
  });
}

async function expectAProgressBarIsMidRun(): Promise<void> {
  await expect(
    launched.window.locator('[role="progressbar"][aria-valuenow]').first(),
  ).toBeVisible({ timeout: 60_000 });
}

async function applyInvertOnTheSameSourceWhileIcaRuns(): Promise<void> {
  await runAsStoryboardStep(launched.window, "Apply Invert on the same source mid-ICA", async () => {
    await selectPanel(launched.window, SOURCE_PANEL);
    await openOperation(launched.window, "Invert");
    await operationPanel(launched.window, "Invert")
      .getByRole("button", { name: "Apply", exact: true })
      .click();
  });
}

async function waitForBothOperationsToComplete(): Promise<void> {
  await runAsStoryboardStep(launched.window, "Wait for ICA and Invert to complete", async () => {
    await expect(panelGrid(launched.window).locator('[role="status"]')).toHaveCount(0, {
      timeout: ICA_COMPLETION_BUDGET_MS,
    });
    await expect(closePanelButton(ICA_RESULT_PANEL)).toBeVisible();
    await expect(closePanelButton(INVERT_RESULT_PANEL)).toBeVisible();
  });
}

// The ICA panel holds the 10 component bands; the Invert panel keeps all 49
// source bands with the displayed band inverted across the uint16 type range.
// Distinct band counts plus the exact inverted readout prove neither result
// blended into the other's panel.
async function verifyTheTwoResultPanelsAreDistinctAndCorrect(): Promise<void> {
  await runAsStoryboardStep(launched.window, "Verify the two result panels", async () => {
    await selectPanel(launched.window, ICA_RESULT_PANEL);
    expect((await readMetadata(launched.window)).bandCount).toBe(String(ICA_DEFAULT_COMPONENT_COUNT));
    const icaPixel = await readReportedPixelNear(
      launched.window,
      ICA_RESULT_PANEL,
      { x: 500, y: 1000 },
      ANNA_BENCHMARK_DIMENSIONS,
    );
    expect(Number.isFinite(icaPixel.value)).toBe(true);

    await selectPanel(launched.window, INVERT_RESULT_PANEL);
    expect((await readMetadata(launched.window)).bandCount).toBe("49");
    const invertedPixel = await readReportedPixelNear(
      launched.window,
      INVERT_RESULT_PANEL,
      { x: 500, y: 1000 },
      ANNA_BENCHMARK_DIMENSIONS,
    );
    const expectedValue = UINT16_MAX - annaBenchmarkValue(0, invertedPixel.x, invertedPixel.y);
    expect(invertedPixel.value).toBe(expectedValue);
  });
}

test("closing panels mid-ICA: the source close is refused, the target close stops the run and stays closed", async () => {
  test.setTimeout(TEST_TIMEOUT_MS);
  await openScale10SingleFile(launched.window, ANNA_BENCHMARK_TIFF_PATH, OPEN_BUDGET_MS);
  await selectPanel(launched.window, SOURCE_PANEL);
  const historyEntriesBefore = await historyEntryCount(launched.window);

  await startIcaOnTheSourcePanel();
  await verifyClosingTheSourcePanelIsRefused();
  await closeTheIcaTargetPanelMidRun();
  await verifyTheTargetStaysClosedAndHistoryIsUnchanged(historyEntriesBefore);
});

async function verifyClosingTheSourcePanelIsRefused(): Promise<void> {
  await runAsStoryboardStep(launched.window, "Refuse closing the ICA source panel", async () => {
    await closePanelButton(SOURCE_PANEL).click();
    await expect(
      launched.window.locator("[data-sonner-toast]", { hasText: CLOSE_SOURCE_REFUSED_TOAST_TEXT }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(closePanelButton(SOURCE_PANEL)).toBeVisible();
  });
}

async function closeTheIcaTargetPanelMidRun(): Promise<void> {
  await runAsStoryboardStep(launched.window, "Close the ICA target panel mid-run", async () => {
    await closePanelButton(ICA_RESULT_PANEL).click();
    await expect(
      launched.window.locator("[data-sonner-toast]", { hasText: OPERATION_STOPPED_TOAST_TEXT }),
    ).toBeVisible({ timeout: 60_000 });
  });
}

async function verifyTheTargetStaysClosedAndHistoryIsUnchanged(
  historyEntriesBefore: number,
): Promise<void> {
  await runAsStoryboardStep(launched.window, "Verify the target stays closed", async () => {
    await expect(panelGrid(launched.window).locator('[role="status"]')).toHaveCount(0, {
      timeout: 60_000,
    });
    await expect(closePanelButton(ICA_RESULT_PANEL)).toHaveCount(0);
    await selectPanel(launched.window, SOURCE_PANEL);
    expect(await historyEntryCount(launched.window)).toBe(historyEntriesBefore);
  });
}

function closePanelButton(panelNumber: number): ReturnType<LaunchedApp["window"]["getByRole"]> {
  return launched.window.getByRole("button", { name: `Close panel ${panelNumber}`, exact: true });
}
