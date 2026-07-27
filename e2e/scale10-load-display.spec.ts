// CT-238 scale10 sweep: load, display, readout, spectra, histogram, and
// browser-photo promotion at the 10 GB / 100-band reference scale.
//
// OPT-IN: runs only with MSI_SCALE10=1 and the generated fixtures present
// (node scripts/generate-scale10-stack.mjs); otherwise every test skips.
// Each test launches a fresh app instance (locked scale10 convention) and the
// status-bar pixel readout is the data oracle: the modulo-100 ramp formula
// value(band, x, y) = (band + 1) * 600 + (x % 100) + (y % 100) makes any
// reported pixel exactly checkable.
//
// Run locally: dev server first (pnpm dev), then
//   MSI_SCALE10=1 MSI_E2E_TRACE_LABEL=CT-238 pnpm e2e scale10-load-display.spec.ts
import { expect, test } from "@playwright/test";

import { selectActiveBandNumber } from "./support/band-navigator";
import { colorfulNonClearPixelFraction, nonClearPixelFraction, summarizeCanvasPixels } from "./support/canvas-pixels";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import { expectNormalizedViewingEnabled, toggleNormalizedViewing } from "./support/normalized-viewing";
import { openOperation } from "./support/operations";
import { panelCanvas, selectPanel } from "./support/panels";
import { pinnedSpectrumLines, pinPixelSpectrum } from "./support/spectra-plot";
import { histogramCanvas } from "./support/stats-panels";
import { runAsStoryboardStep } from "./support/storyboard-step";
import {
  applyOperationWithBudget,
  expectNoRawAllocationFailureToast,
  expectValueCloseTo,
  openScale10GroupedBandFiles,
  openScale10SingleFile,
  readRendererWorkingSetMb,
  readReportedPixelNear,
  recordScale10Result,
  SCALE10_APPLY_BUDGET_MS,
  SCALE10_BIG_PHOTO_PATH,
  SCALE10_DIMENSIONS,
  SCALE10_GROUPED_OPEN_BUDGET_MS,
  SCALE10_MAX_UI_GAP_MS,
  SCALE10_REFERENCE_HEADER_PATH,
  SCALE10_RENDERER_WORKING_SET_LIMIT_MB,
  SCALE10_SINGLE_FILE_OPEN_BUDGET_MS,
  scale10PhotoChannels,
  scale10Value,
  skipUnlessScale10SweepIsEnabled,
  startUiHeartbeat,
  stopUiHeartbeatAndReadMaxGapMs,
} from "./scale10.support";

const SOURCE_PANEL = 1;
const RESULT_PANEL = 2;
const PROBE_PIXEL = { x: 150, y: 250 };
const SPECTRA_PROBE_PIXEL = { x: 5_000, y: 2_500 };
const PHOTO_PROBE_PIXEL = { x: 2_450, y: 1_850 };

const SINGLE_FILE_TEST_TIMEOUT_MS = 45 * 60_000;
const GROUPED_TEST_TIMEOUT_MS = 45 * 60_000;
const PHOTO_TEST_TIMEOUT_MS = 50 * 60_000;
const PHOTO_OPEN_BUDGET_MS = 15 * 60_000;
const HISTOGRAM_BUDGET_MS = 10 * 60_000;
const STEADY_STATE_DELAY_MS = 30_000;
const DISPLAY_NON_CLEAR_FLOOR = 0.1;
const COLORFUL_FRACTION_FLOOR = 0.3;
const GRAYSCALE_TOLERANCE = 2;
const RGB_TO_GRAYSCALE_LABEL = "RGB to Grayscale";
const LUMINANCE_WEIGHTS = { red: 0.299, green: 0.587, blue: 0.114 } as const;

let launched: LaunchedApp;

test.beforeEach(async () => {
  skipUnlessScale10SweepIsEnabled();
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

test("single-file ENVI open streams the 10 GB capture with determinate progress, exact oracle readout, and bounded steady-state memory", async () => {
  test.setTimeout(SINGLE_FILE_TEST_TIMEOUT_MS);
  const load = await openScale10SingleFile(
    launched.window,
    SCALE10_REFERENCE_HEADER_PATH,
    SCALE10_SINGLE_FILE_OPEN_BUDGET_MS,
  );
  expect(load.sawDeterminateProgressBar, "the streamed open must show a determinate progressbar").toBe(true);
  await selectPanel(launched.window, SOURCE_PANEL);
  const oracle = await verifyOracleReadoutOnBands([1, 50, 100]);
  const steadyStateWorkingSetMb = await readSteadyStateWorkingSetMb();
  expect(steadyStateWorkingSetMb).toBeLessThan(SCALE10_RENDERER_WORKING_SET_LIMIT_MB);
  recordScale10Result({
    area: "load: single-file ENVI (10 GB BSQ, CT-231 streamed decode)",
    verdict: "pass",
    loadMs: load.loadMs,
    loadMaxUiGapMs: load.maxUiGapMs,
    steadyStateWorkingSetMb,
    oracle,
  });
});

test("grouped open builds one 100-band stack whose display, spectra, and histogram stay responsive", async () => {
  test.setTimeout(GROUPED_TEST_TIMEOUT_MS);
  const load = await openScale10GroupedBandFiles(launched.window, SCALE10_GROUPED_OPEN_BUDGET_MS);
  await selectPanel(launched.window, SOURCE_PANEL);
  await enableNormalizedViewingForDisplaySampling();
  const band1 = await verifyOracleReadoutAndDisplayOnBand(1);
  const band100 = await verifyOracleReadoutAndDisplayOnBand(100);
  const panelsMaxUiGapMs = await verifySpectraAndHistogramRenderResponsively();
  recordScale10Result({
    area: "load: 100 grouped band TIFFs (Review stacks) + GPU display + spectra + histogram",
    verdict: "pass",
    loadMs: load.loadMs,
    loadMaxUiGapMs: load.maxUiGapMs,
    panelsMaxUiGapMs,
    oracle: `${band1}; ${band100}`,
  });
});

test("the big browser photo promotes to a stack and rgb-to-grayscale reads out the channel formula", async () => {
  test.setTimeout(PHOTO_TEST_TIMEOUT_MS);
  const load = await openScale10SingleFile(launched.window, SCALE10_BIG_PHOTO_PATH, PHOTO_OPEN_BUDGET_MS);
  await expectPhotoRendersInColor();
  await selectPanel(launched.window, SOURCE_PANEL);
  await openOperation(launched.window, RGB_TO_GRAYSCALE_LABEL);
  const apply = await applyOperationWithBudget(launched.window, RGB_TO_GRAYSCALE_LABEL, SCALE10_APPLY_BUDGET_MS);
  const oracle = await verifyGrayscaleReadoutAgainstPhotoFormula();
  await expectNoRawAllocationFailureToast(launched.window);
  recordScale10Result({
    area: "load: browser photo promotion (50 MP PNG) + RGB to Grayscale",
    verdict: "pass",
    loadMs: load.loadMs,
    applyMs: apply.applyMs,
    applyMaxUiGapMs: apply.maxUiGapMs,
    oracle,
  });
});

async function verifyOracleReadoutOnBands(bandNumbers: ReadonlyArray<number>): Promise<string> {
  const verdicts: string[] = [];
  for (const bandNumber of bandNumbers) {
    verdicts.push(await verifyOracleReadoutOnBand(bandNumber));
  }
  return verdicts.join("; ");
}

async function verifyOracleReadoutOnBand(bandNumber: number): Promise<string> {
  return runAsStoryboardStep(launched.window, `Verify the oracle readout on band ${bandNumber}`, async () => {
    await selectActiveBandNumber(launched.window, bandNumber);
    const reported = await readReportedPixelNear(launched.window, SOURCE_PANEL, PROBE_PIXEL, SCALE10_DIMENSIONS);
    const expected = scale10Value(bandNumber - 1, reported.x, reported.y);
    expectValueCloseTo(reported.value, expected, 0, `band ${bandNumber} readout at (${reported.x}, ${reported.y})`);
    return `band ${bandNumber}: pixel (${reported.x}, ${reported.y}) = ${reported.value}`;
  });
}

// The LOCKED display convention (CT-148) maps integers across the data-type
// range with no auto-stretch, so band 1 (values 600..798 of 65535) renders
// near-black by DESIGN. Normalized viewing is the display-only stretch that
// makes "the GPU actually painted this band" observable at every band, and
// the readout oracle stays exact because the data never changes.
async function enableNormalizedViewingForDisplaySampling(): Promise<void> {
  await runAsStoryboardStep(launched.window, "Enable normalized viewing for display sampling", async () => {
    await toggleNormalizedViewing(launched.window, SOURCE_PANEL);
    await expectNormalizedViewingEnabled(launched.window, SOURCE_PANEL, true);
  });
}

async function verifyOracleReadoutAndDisplayOnBand(bandNumber: number): Promise<string> {
  return runAsStoryboardStep(launched.window, `Verify readout and GPU display on band ${bandNumber}`, async () => {
    const oracle = await verifyOracleReadoutOnBand(bandNumber);
    await expect
      .poll(() => readSourcePanelNonClearFraction(), { timeout: 120_000 })
      .toBeGreaterThan(DISPLAY_NON_CLEAR_FLOOR);
    const fraction = await readSourcePanelNonClearFraction();
    return `${oracle} (nonClearFraction ${fraction.toFixed(3)})`;
  });
}

async function readSourcePanelNonClearFraction(): Promise<number> {
  return nonClearPixelFraction(await summarizeCanvasPixels(panelCanvas(launched.window, SOURCE_PANEL)));
}

async function verifySpectraAndHistogramRenderResponsively(): Promise<number> {
  const label = "Pin a spectrum and wait for the histogram under the UI-gap threshold";
  return runAsStoryboardStep(launched.window, label, async () => {
    await startUiHeartbeat(launched.window);
    await pinPixelSpectrum(launched.window, SOURCE_PANEL, SPECTRA_PROBE_PIXEL.x, SPECTRA_PROBE_PIXEL.y, SCALE10_DIMENSIONS);
    await expect(pinnedSpectrumLines(launched.window).first()).toBeVisible({ timeout: HISTOGRAM_BUDGET_MS });
    await expect(histogramCanvas(launched.window)).toBeVisible({ timeout: HISTOGRAM_BUDGET_MS });
    const maxUiGapMs = await stopUiHeartbeatAndReadMaxGapMs(launched.window);
    expect(maxUiGapMs, "spectra + histogram must not exceed the UI-gap threshold").toBeLessThanOrEqual(SCALE10_MAX_UI_GAP_MS);
    return maxUiGapMs;
  });
}

async function readSteadyStateWorkingSetMb(): Promise<number> {
  const label = `Sample the renderer working set after ${STEADY_STATE_DELAY_MS / 1000} s of steady state`;
  return runAsStoryboardStep(launched.window, label, async () => {
    await launched.window.waitForTimeout(STEADY_STATE_DELAY_MS);
    return readRendererWorkingSetMb(launched.app);
  });
}

async function expectPhotoRendersInColor(): Promise<void> {
  await runAsStoryboardStep(launched.window, "Verify the promoted photo renders as a colour composite", async () => {
    await expect
      .poll(() => colorfulNonClearPixelFraction(panelCanvas(launched.window, SOURCE_PANEL)), { timeout: 60_000 })
      .toBeGreaterThan(COLORFUL_FRACTION_FLOOR);
  });
}

async function verifyGrayscaleReadoutAgainstPhotoFormula(): Promise<string> {
  return runAsStoryboardStep(launched.window, "Verify the grayscale readout against the photo channel formula", async () => {
    const reported = await readReportedPixelNear(launched.window, RESULT_PANEL, PHOTO_PROBE_PIXEL, SCALE10_DIMENSIONS);
    const expected = expectedLuminanceGrayValueAt(reported.x, reported.y);
    expectValueCloseTo(reported.value, expected, GRAYSCALE_TOLERANCE, "grayscale readout");
    return `pixel (${reported.x}, ${reported.y}) read ${reported.value}, expected ~${expected.toFixed(2)}`;
  });
}

function expectedLuminanceGrayValueAt(x: number, y: number): number {
  const channels = scale10PhotoChannels(x, y);
  return (
    LUMINANCE_WEIGHTS.red * channels.red +
    LUMINANCE_WEIGHTS.green * channels.green +
    LUMINANCE_WEIGHTS.blue * channels.blue
  );
}
