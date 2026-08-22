// CT-267: rotate and flip finish in under 5 seconds at the Anna benchmark
// (1000 x 2000 x 49-band uint16, ~196 MB, generated on demand into the
// gitignored .scale-audit/ directory - never committed).
//
// The acceptance bar is the DEV-MACHINE target of 5 s per apply; the committed
// assertion multiplies it by the same generous CI headroom the scale10 sweeps
// build into their budgets, so a loaded runner cannot flake a genuinely fast
// transform. Correctness rides on the pixel-readout oracle: the benchmark's
// value(band, x, y) formula makes WHATEVER pixel the status bar reports
// exactly checkable after each coordinate remap (the scale10 tolerant-hover
// pattern). The per-band determinate progress and the 1 s UI-gap ceiling from
// the story are asserted on the same runs.
//
// Run locally: dev server first (pnpm dev), then
//   MSI_E2E_TRACE_LABEL=CT-267 pnpm e2e ct267-rotate-flip-perf.spec.ts
import { expect, test } from "@playwright/test";

import {
  ANNA_BENCHMARK_BAND_COUNT,
  ANNA_BENCHMARK_DIMENSIONS,
  ANNA_BENCHMARK_TIFF_PATH,
  annaBenchmarkValue,
  ensureAnnaBenchmarkFixtureExists,
} from "./anna-benchmark.support";
import {
  applyOperationWithBudget,
  closeGridPanel,
  openScale10SingleFile,
  readReportedPixelNear,
  type TimedApply,
} from "./scale10.support";
import type { PixelDimensions } from "./support/image-pixel-canvas-mapping";
import { closeToolboxApp, launchToolboxApp, type LaunchedApp } from "./support/launch-app";
import { readMetadata } from "./support/metadata-panel";
import { openOperation } from "./support/operations";
import { selectPanel } from "./support/panels";
import { runAsStoryboardStep } from "./support/storyboard-step";

const SOURCE_PANEL = 1;
const RESULT_PANEL = 2;

// 5 s is the CT-267 dev-machine target; 3x is the CI headroom.
const DEV_MACHINE_APPLY_TARGET_MS = 5_000;
const CI_HEADROOM_MULTIPLIER = 3;
const APPLY_BOUND_MS = DEV_MACHINE_APPLY_TARGET_MS * CI_HEADROOM_MULTIPLIER;
const MAX_UI_GAP_MS = 1_000;

const OPEN_BUDGET_MS = 4 * 60_000;
const TEST_TIMEOUT_MS = 15 * 60_000;

const ROTATED_DIMENSIONS: PixelDimensions = {
  width: ANNA_BENCHMARK_DIMENSIONS.height,
  height: ANNA_BENCHMARK_DIMENSIONS.width,
};
const ROTATED_PROBE_PIXEL = { x: 700, y: 350 };
const FLIPPED_PROBE_PIXEL = { x: 350, y: 700 };

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

test("rotate 90 and flip horizontal each finish inside the Anna-benchmark bound with exact remaps", async () => {
  test.setTimeout(TEST_TIMEOUT_MS);
  await openAnnaBenchmarkIntoSourcePanel();

  const rotate = await applyGeometricOperationFromSourcePanel("Rotate");
  await verifyRotatedResultPixelAndBandCount();
  await closeGridPanel(launched.window, RESULT_PANEL);

  const flip = await applyGeometricOperationFromSourcePanel("Flip");
  await verifyFlippedResultPixel();

  console.log(
    `CT-267 timings: rotate 90 ${rotate.applyMs} ms (gap ${rotate.maxUiGapMs} ms), ` +
      `flip horizontal ${flip.applyMs} ms (gap ${flip.maxUiGapMs} ms)`,
  );
});

async function openAnnaBenchmarkIntoSourcePanel(): Promise<void> {
  await openScale10SingleFile(launched.window, ANNA_BENCHMARK_TIFF_PATH, OPEN_BUDGET_MS);
  await selectPanel(launched.window, SOURCE_PANEL);
}

// Rotate defaults to "Rotate 90 clockwise" and Flip to "Flip horizontal"
// (the first choice of each enum), so no configuration step is needed.
async function applyGeometricOperationFromSourcePanel(operationLabel: string): Promise<TimedApply> {
  await selectPanel(launched.window, SOURCE_PANEL);
  await openOperation(launched.window, operationLabel);
  const timing = await applyOperationWithBudget(launched.window, operationLabel, APPLY_BOUND_MS);
  assertApplyMetTheAnnaBenchmarkBounds(operationLabel, timing);
  return timing;
}

function assertApplyMetTheAnnaBenchmarkBounds(operationLabel: string, timing: TimedApply): void {
  expect(
    timing.applyMs,
    `${operationLabel} must finish within ${APPLY_BOUND_MS} ms (${DEV_MACHINE_APPLY_TARGET_MS} ms dev target x ${CI_HEADROOM_MULTIPLIER})`,
  ).toBeLessThanOrEqual(APPLY_BOUND_MS);
  expect(
    timing.maxUiGapMs,
    `${operationLabel} must keep every UI gap under ${MAX_UI_GAP_MS} ms`,
  ).toBeLessThanOrEqual(MAX_UI_GAP_MS);
  expect(
    timing.sawDeterminateProgressBar,
    `${operationLabel} must show determinate per-band progress`,
  ).toBe(true);
}

// Rotate 90 cw maps source (x, y) to destination (h - 1 - y, x), so the value
// reported at destination (X, Y) came from source (Y, h - 1 - X).
async function verifyRotatedResultPixelAndBandCount(): Promise<void> {
  await runAsStoryboardStep(launched.window, "Verify the rotated pixel readout and band count", async () => {
    const reported = await readReportedPixelNear(
      launched.window,
      RESULT_PANEL,
      ROTATED_PROBE_PIXEL,
      ROTATED_DIMENSIONS,
    );
    const sourceX = reported.y;
    const sourceY = ANNA_BENCHMARK_DIMENSIONS.height - 1 - reported.x;
    expect(reported.value).toBe(annaBenchmarkValue(0, sourceX, sourceY));
    await expectResultPanelKeepsTheBenchmarkBandCount();
  });
}

async function expectResultPanelKeepsTheBenchmarkBandCount(): Promise<void> {
  await selectPanel(launched.window, RESULT_PANEL);
  const metadata = await readMetadata(launched.window);
  expect(metadata.bandCount).toBe(String(ANNA_BENCHMARK_BAND_COUNT));
}

// Flip horizontal maps source (x, y) to destination (w - 1 - x, y).
async function verifyFlippedResultPixel(): Promise<void> {
  await runAsStoryboardStep(launched.window, "Verify the flipped pixel readout", async () => {
    const reported = await readReportedPixelNear(
      launched.window,
      RESULT_PANEL,
      FLIPPED_PROBE_PIXEL,
      ANNA_BENCHMARK_DIMENSIONS,
    );
    const sourceX = ANNA_BENCHMARK_DIMENSIONS.width - 1 - reported.x;
    expect(reported.value).toBe(annaBenchmarkValue(0, sourceX, reported.y));
  });
}
