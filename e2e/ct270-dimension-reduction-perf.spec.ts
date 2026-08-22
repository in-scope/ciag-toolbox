// CT-270: dimension reduction meets wall-clock targets at the Anna benchmark
// (1000 x 2000 x 49-band uint16, generated on demand into the gitignored
// .scale-audit/): PCA under 60 s, MNF and ICA under 3 minutes, with every UI
// gap under 1 s. The committed assertions multiply the dev-machine targets by
// the same generous CI headroom as the scale10 sweeps.
//
// The benchmark cube is rank-1 (every band is the same modulo-100 ramp plus a
// per-band constant), so PCA's leading component is exactly predictable: the
// unit eigenvector is (1, ..., 1) / 7 up to sign, the per-band mean offset is
// exactly 99 (the ramp averages 49.5 per axis over whole cycles), and PC 1 at
// (x, y) is +/- 7 * ((x % 100) + (y % 100) - 99). That is the component-band
// readout sanity value; MNF and ICA component ordering on floored-eigenvalue
// whitenings is not pinned, so their readouts assert a real finite value plus
// the kept component count.
//
// Run locally: dev server first (pnpm dev), then
//   MSI_E2E_TRACE_LABEL=CT-270 pnpm e2e ct270-dimension-reduction-perf.spec.ts
import { expect, test } from "@playwright/test";

import {
  ANNA_BENCHMARK_DIMENSIONS,
  ANNA_BENCHMARK_TIFF_PATH,
  ensureAnnaBenchmarkFixtureExists,
} from "./anna-benchmark.support";
import {
  applyOperationWithBudget,
  closeGridPanel,
  expectFloatReadoutCloseTo,
  openScale10SingleFile,
  readReportedPixelNear,
  type ReportedPixel,
  type TimedApply,
} from "./scale10.support";
import { closeToolboxApp, launchToolboxApp, type LaunchedApp } from "./support/launch-app";
import { readMetadata } from "./support/metadata-panel";
import { openOperation } from "./support/operations";
import { selectPanel } from "./support/panels";
import { runAsStoryboardStep } from "./support/storyboard-step";

const SOURCE_PANEL = 1;
const RESULT_PANEL = 2;

const CI_HEADROOM_MULTIPLIER = 3;
const PCA_DEV_MACHINE_TARGET_MS = 60_000;
const MNF_DEV_MACHINE_TARGET_MS = 3 * 60_000;
const ICA_DEV_MACHINE_TARGET_MS = 3 * 60_000;
const MAX_UI_GAP_MS = 1_000;

const OPEN_BUDGET_MS = 4 * 60_000;
const TEST_TIMEOUT_MS = 45 * 60_000;

const DEFAULT_KEPT_COMPONENT_COUNT = 10;
// Away from the ramp wrap so every pixel the tolerant hover lands on keeps
// (x % 100) + (y % 100) far below the 99 mean offset (a clearly non-zero PC 1).
const COMPONENT_PROBE_PIXEL = { x: 25, y: 25 };
// Headroom above readout display rounding for the eigen-decomposition's own
// numerical error on the rank-1 covariance.
const PCA_EIGENVECTOR_TOLERANCE = 0.05;

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

test("PCA, MNF, and ICA each meet their Anna-benchmark wall-clock target with sane components", async () => {
  test.setTimeout(TEST_TIMEOUT_MS);
  await openScale10SingleFile(launched.window, ANNA_BENCHMARK_TIFF_PATH, OPEN_BUDGET_MS);

  const pca = await applyDimensionReductionFromSourcePanel("PCA", PCA_DEV_MACHINE_TARGET_MS);
  await verifyLeadingPrincipalComponentReadsTheExactRampProjection();
  await closeGridPanel(launched.window, RESULT_PANEL);

  const mnf = await applyDimensionReductionFromSourcePanel("MNF", MNF_DEV_MACHINE_TARGET_MS);
  await verifyComponentStackHoldsARealFiniteComponentValue("MNF");
  await closeGridPanel(launched.window, RESULT_PANEL);

  const ica = await applyDimensionReductionFromSourcePanel("ICA", ICA_DEV_MACHINE_TARGET_MS);
  await verifyComponentStackHoldsARealFiniteComponentValue("ICA");

  console.log(
    `CT-270 timings: PCA ${pca.applyMs} ms (gap ${pca.maxUiGapMs} ms), ` +
      `MNF ${mnf.applyMs} ms (gap ${mnf.maxUiGapMs} ms), ` +
      `ICA ${ica.applyMs} ms (gap ${ica.maxUiGapMs} ms)`,
  );
});

async function applyDimensionReductionFromSourcePanel(
  operationLabel: string,
  devMachineTargetMs: number,
): Promise<TimedApply> {
  await selectPanel(launched.window, SOURCE_PANEL);
  await openOperation(launched.window, operationLabel);
  const budgetMs = devMachineTargetMs * CI_HEADROOM_MULTIPLIER;
  const timing = await applyOperationWithBudget(launched.window, operationLabel, budgetMs);
  assertApplyMetTheAnnaBenchmarkBounds(operationLabel, timing, devMachineTargetMs);
  return timing;
}

function assertApplyMetTheAnnaBenchmarkBounds(
  operationLabel: string,
  timing: TimedApply,
  devMachineTargetMs: number,
): void {
  const budgetMs = devMachineTargetMs * CI_HEADROOM_MULTIPLIER;
  expect(
    timing.applyMs,
    `${operationLabel} must finish within ${budgetMs} ms (${devMachineTargetMs} ms dev target x ${CI_HEADROOM_MULTIPLIER})`,
  ).toBeLessThanOrEqual(budgetMs);
  expect(
    timing.maxUiGapMs,
    `${operationLabel} must keep every UI gap under ${MAX_UI_GAP_MS} ms`,
  ).toBeLessThanOrEqual(MAX_UI_GAP_MS);
  expect(
    timing.sawDeterminateProgressBar,
    `${operationLabel} must show determinate progress`,
  ).toBe(true);
}

// PC 1 of the rank-1 benchmark cube at the reported pixel is exactly
// +/- 7 * ((x % 100) + (y % 100) - 99); the sign depends only on the eigen
// solver's vector orientation, so the oracle compares magnitudes.
async function verifyLeadingPrincipalComponentReadsTheExactRampProjection(): Promise<void> {
  await runAsStoryboardStep(launched.window, "Verify the PC 1 readout against the ramp formula", async () => {
    const reported = await readComponentProbePixel();
    const expectedMagnitude = 7 * Math.abs((reported.x % 100) + (reported.y % 100) - 99);
    expectFloatReadoutCloseTo(
      Math.abs(reported.value),
      expectedMagnitude,
      "PC 1 at the reported pixel",
      PCA_EIGENVECTOR_TOLERANCE,
    );
    await expectResultPanelKeepsTheDefaultComponentCount();
  });
}

async function verifyComponentStackHoldsARealFiniteComponentValue(
  operationLabel: string,
): Promise<void> {
  await runAsStoryboardStep(
    launched.window,
    `Verify the ${operationLabel} component stack readout and band count`,
    async () => {
      const reported = await readComponentProbePixel();
      expect(Number.isFinite(reported.value), `${operationLabel} component value must be finite`).toBe(true);
      await expectResultPanelKeepsTheDefaultComponentCount();
    },
  );
}

async function readComponentProbePixel(): Promise<ReportedPixel> {
  return readReportedPixelNear(
    launched.window,
    RESULT_PANEL,
    COMPONENT_PROBE_PIXEL,
    ANNA_BENCHMARK_DIMENSIONS,
  );
}

async function expectResultPanelKeepsTheDefaultComponentCount(): Promise<void> {
  await selectPanel(launched.window, RESULT_PANEL);
  const metadata = await readMetadata(launched.window);
  expect(metadata.bandCount).toBe(String(DEFAULT_KEPT_COMPONENT_COUNT));
}
