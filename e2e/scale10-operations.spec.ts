// CT-239 scale10 sweep: the full operations pass at reference scale.
//
// THE SCALE SPLIT (measured platform cap, probe 2026-07-14): the renderer's
// V8 sandbox caps TOTAL ArrayBuffer memory at ~17,000,000,000 bytes per
// process, independent of system RAM and pagefile, and a live session's
// unaccounted state (texture staging, histograms) consumes ~2 GB of it. The
// 10 GB / 100-band capture plus a full-stack float32 result (20 GB) can
// therefore never coexist, so:
// - OPERATION tests open the FIRST 45 BANDS (4.5 GB, full 10000x5000 spatial
//   size) via the grouped route: source (4.5 GB) + float32 result (9 GB) +
//   operation transients fits the pool with slack, and every whole-stack
//   operation genuinely succeeds.
// - A dedicated test opens the FULL 100-band stack and asserts the CT-239
//   memory-budget guard refuses over-pool applies with the exact
//   in-vocabulary copy, before any panel is reserved.
//
// One test per operation area; every test launches a fresh app instance and
// applies AT MOST TWO operations in that instance, closing the first result
// panel before the second apply so two full-scale results never coexist.
//
// Every data-changing apply asserts a post-apply status-bar readout against
// the oracle transform of the input formula
// value(band, x, y) = (band + 1) * 600 + (x % 100) + (y % 100):
// exact where the operation is exactly computable (invert, bit shift, clip,
// threshold, crop, rotate/reflect coordinate remaps, false-color band
// aliasing), and at float-readout precision or with an explicit tolerance
// where float math is involved. The spatial filter runs band-wise on band 1:
// each filtered band costs the same FFT as a full-stack pass, and the
// CT-219 timing evidence (567 s for 16 bands) puts even a 45-band pass
// beyond the 30-minute apply budget by design, not by regression.
//
// OPT-IN: runs only with MSI_SCALE10=1 and the generated fixtures present
// (node scripts/generate-scale10-stack.mjs); otherwise every test skips.
// Run locally: dev server first (pnpm dev), then
//   MSI_SCALE10=1 MSI_E2E_TRACE_LABEL=CT-239 pnpm e2e scale10-operations.spec.ts
import { expect, test } from "@playwright/test";

import { selectFullImageScope, selectWholeStackScope } from "./support/apply-scope-control";
import { nonClearPixelFraction, summarizeCanvasPixels } from "./support/canvas-pixels";
import { toggleChannelView } from "./support/channel-view";
import { selectBandWiseScopeForBands, selectFullStackScope } from "./support/cube-scope-control";
import { chooseFlatFieldReferenceFileThroughDialog, FLAT_FIELD_LIGHT_FIELD_LABEL } from "./support/flat-field-operation";
import { readHistoryEntries } from "./support/history-panel";
import type { PixelDimensions } from "./support/image-pixel-canvas-mapping";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import { openOperation, operationPanel, setOperationEnumParameter, setOperationNumberParameter } from "./support/operations";
import { selectOperationRegionByDrag } from "./support/operation-region-picker";
import { panelCanvas, selectPanel } from "./support/panels";
import { runAsStoryboardStep } from "./support/storyboard-step";
import {
  clickThresholdOtsuAutoButton,
  readThresholdBoundFieldValue,
  setThresholdBoundField,
} from "./support/threshold-editor";
import { setToneCurveAnchorField } from "./support/tone-curve-editor";
import {
  applyOperationWithBudget,
  closeGridPanel,
  countGridPanels,
  expectFloatReadoutCloseTo,
  expectNoRawAllocationFailureToast,
  expectValueCloseTo,
  forceRendererGarbageCollection,
  openScale10GroupedBandFiles,
  readReportedPixelNear,
  readSmoothInteriorPixel,
  readVisibleToastTexts,
  recordScale10Result,
  SCALE10_APPLY_BUDGET_MS,
  SCALE10_BAND_COUNT,
  SCALE10_DIMENSIONS,
  SCALE10_FLAT_FIELD_PATH,
  SCALE10_GROUPED_OPEN_BUDGET_MS,
  SCALE10_MAX_UI_GAP_MS,
  scale10Value,
  selectActiveBandNumberInPanel,
  skipUnlessScale10SweepIsEnabled,
  startUiHeartbeat,
  stopUiHeartbeatAndReadMaxGapMs,
} from "./scale10.support";

const SOURCE_PANEL = 1;
const RESULT_PANEL = 2;
const PROBE_PIXEL = { x: 150, y: 250 };

// Timeouts sit above the sum of the wall-clock budgets they contain (grouped
// open 30 min + one or two 30-min applies); the budgets themselves are the
// acceptance bar and fail first.
const ONE_APPLY_TEST_TIMEOUT_MS = 70 * 60_000;
const TWO_APPLY_TEST_TIMEOUT_MS = 100 * 60_000;
const OTSU_DERIVE_BUDGET_MS = 20 * 60_000;

// Operation tests run on the first 45 bands (4.5 GB): at-scale evidence put a
// live session's usable pool near 15.2 GB (texture staging, histograms, and
// app state consume ~2 GB of the bare-window 17 GB), so 50 bands (5 + 10 GB
// + transients) sat exactly on the cliff edge and 45 leaves real slack.
const OPS_BAND_COUNT = 45;
const OPS_TOP_BAND_NUMBER = OPS_BAND_COUNT;
const OPS_TOP_BAND_INDEX = OPS_BAND_COUNT - 1;

const UINT16_MAX = 65_535;
const THRESHOLD_WHITE = 255;
const THRESHOLD_BLACK = 0;
const THRESHOLD_MANUAL_LOWER_BOUND = 700;
const BIT_SHIFT_FACTOR = 16; // default shift amount 4 doubles four times
const CLIP_LOW = 700;
const CLIP_HIGH = 20_000;
const OPS_STACK_MIN = 600; // value(band 1, 0, 0)
const OPS_STACK_MAX = OPS_BAND_COUNT * 600 + 198; // value(band 50, 99, 99)
// Per band the ramp sum is two independent uniforms over 0..99:
// mean 99, variance 2 * (100^2 - 1) / 12 = 1666.5.
const RAMP_MEAN = 99;
const RAMP_STANDARD_DEVIATION = Math.sqrt(1666.5);
const FLAT_FIELD_BASE = 500;
const FLAT_FIELD_MEAN = FLAT_FIELD_BASE + RAMP_MEAN; // exact: full ramp cycles
const SPECTRALON_REGION_BAND_1_MEAN = 600 + RAMP_MEAN;
// The drag-committed Spectralon region deviates from the requested rectangle
// by a few canvas pixels, shifting the region mean by up to ~2 data units.
const SPECTRALON_TOLERANCE = 0.01;
const GAUSSIAN_DENOISE_TOLERANCE = 1.5;
const MEDIAN_DENOISE_TOLERANCE = 0.5;
const SPATIAL_FILTER_TOLERANCE = 5;
const DISPLAY_NON_CLEAR_FLOOR = 0.1;

const ROTATED_DIMENSIONS: PixelDimensions = {
  width: SCALE10_DIMENSIONS.height,
  height: SCALE10_DIMENSIONS.width,
};
const ROTATED_PROBE_PIXEL = { x: 2_000, y: 4_000 };
const OPERATION_REGION = { start: { x: 1_000, y: 1_000 }, end: { x: 3_000, y: 2_600 } };
const SPECTRALON_REGION = { start: { x: 1_000, y: 1_000 }, end: { x: 2_000, y: 2_000 } };

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

// --- oracle math ------------------------------------------------------------------

function rampSum(x: number, y: number): number {
  return (x % 100) + (y % 100);
}

function clampToRange(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

// The ramp sum s = (x % 100) + (y % 100) is triangular over 0..198, and the
// image holds exact whole cycles (10000 and 5000 are multiples of 100), so
// each residue pair occurs exactly 100 * 50 = 5000 times.
const RAMP_PAIR_OCCURRENCES = 5_000;

function rampSumMultiplicity(s: number): number {
  return s <= 99 ? s + 1 : 199 - s;
}

interface SortedValueRun {
  readonly value: number;
  readonly count: number;
}

// Band values never overlap (band spacing 600 > ramp max 198), so ascending
// (band, s) order IS global sorted order for any band subset.
function listSortedValueRunsForBands(bandNumbers: ReadonlyArray<number>): SortedValueRun[] {
  const runs: SortedValueRun[] = [];
  for (const bandNumber of [...bandNumbers].sort((a, b) => a - b)) {
    for (let s = 0; s <= 198; s += 1) {
      runs.push({ value: 600 * bandNumber + s, count: RAMP_PAIR_OCCURRENCES * rampSumMultiplicity(s) });
    }
  }
  return runs;
}

function sortedValueAtRank(runs: ReadonlyArray<SortedValueRun>, rank: number): number {
  let cumulativeCount = 0;
  for (const run of runs) {
    cumulativeCount += run.count;
    if (rank < cumulativeCount) return run.value;
  }
  throw new Error(`Rank ${rank} lies beyond the modelled value multiset`);
}

// numpy's default linear percentile (rank p/100 * (n - 1) interpolated between
// order statistics) over the modelled multiset - the same definition the app's
// percentile-clip module implements, computed from counts instead of 5e9 values.
function percentileOverSortedRuns(
  runs: ReadonlyArray<SortedValueRun>,
  totalCount: number,
  percentile: number,
): number {
  const rank = (percentile / 100) * (totalCount - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.min(lowerIndex + 1, totalCount - 1);
  const lowerValue = sortedValueAtRank(runs, lowerIndex);
  const upperValue = sortedValueAtRank(runs, upperIndex);
  return lowerValue + (rank - lowerIndex) * (upperValue - lowerValue);
}

interface PercentileCutPoints {
  readonly lower: number;
  readonly upper: number;
}

function computeScale10PercentileCutPoints(bandNumbers: ReadonlyArray<number>): PercentileCutPoints {
  const runs = listSortedValueRunsForBands(bandNumbers);
  const totalCount = runs.reduce((sum, run) => sum + run.count, 0);
  return {
    lower: percentileOverSortedRuns(runs, totalCount, 2),
    upper: percentileOverSortedRuns(runs, totalCount, 98),
  };
}

function listOperationScaleBandNumbers(): number[] {
  return Array.from({ length: OPS_BAND_COUNT }, (_unused, index) => index + 1);
}

// --- sweep flow -------------------------------------------------------------------

// The grouped decode leaves gigabytes of transient buffers (file chunks,
// decoder scratch) whose collection timing is nondeterministic, and a
// full-scale float apply right after the open needs most of the pool - so
// both openers force collection before returning, and closing a result panel
// forces collection before the instance's second apply allocates.
async function openOperationScaleStackViaGroupedFiles(): Promise<void> {
  await openScale10GroupedBandFiles(launched.window, SCALE10_GROUPED_OPEN_BUDGET_MS, OPS_BAND_COUNT);
  await selectPanel(launched.window, SOURCE_PANEL);
  await forceRendererGarbageCollection(launched.window);
}

async function openFullScaleStackViaGroupedFiles(): Promise<void> {
  await openScale10GroupedBandFiles(launched.window, SCALE10_GROUPED_OPEN_BUDGET_MS, SCALE10_BAND_COUNT);
  await selectPanel(launched.window, SOURCE_PANEL);
  await forceRendererGarbageCollection(launched.window);
}

async function closeResultPanelAndLetMemorySettle(): Promise<void> {
  await closeGridPanel(launched.window, RESULT_PANEL);
  await forceRendererGarbageCollection(launched.window);
}

interface AppliedOperation {
  readonly applyMs: number;
  readonly maxUiGapMs: number;
}

async function openConfigureAndApplyFromSourcePanel(
  operationLabel: string,
  configure?: () => Promise<void>,
): Promise<AppliedOperation> {
  await selectPanel(launched.window, SOURCE_PANEL);
  await openOperation(launched.window, operationLabel);
  if (configure) await configure();
  return applyAssertingSweepBudgets(operationLabel);
}

async function applyAssertingSweepBudgets(operationLabel: string): Promise<AppliedOperation> {
  const timing = await applyOperationWithBudget(launched.window, operationLabel, SCALE10_APPLY_BUDGET_MS);
  expect(
    timing.maxUiGapMs,
    `${operationLabel} must stay under the ${SCALE10_MAX_UI_GAP_MS} ms UI-gap threshold`,
  ).toBeLessThanOrEqual(SCALE10_MAX_UI_GAP_MS);
  await expectNoRawAllocationFailureToast(launched.window);
  return { applyMs: timing.applyMs, maxUiGapMs: timing.maxUiGapMs };
}

async function recordSweepVerdict(
  area: string,
  run: () => Promise<Record<string, unknown>>,
): Promise<void> {
  try {
    recordScale10Result({ area, verdict: "pass", ...(await run()) });
  } catch (error) {
    await recordSweepFailureEvidence(area, error);
    throw error;
  }
}

async function recordSweepFailureEvidence(area: string, error: unknown): Promise<void> {
  recordScale10Result({
    area,
    verdict: "fail",
    error: String(error).slice(0, 400),
    toasts: await readVisibleToastTexts(launched.window).catch(() => []),
  });
}

// --- readout verification ---------------------------------------------------------

type SourcePixelOracle = (reportedX: number, reportedY: number) => number;
type ReadoutComparison = (actual: number, expected: number, label: string) => void;

interface ReadoutProbeOptions {
  readonly probe?: { x: number; y: number };
  readonly dimensions?: PixelDimensions;
}

function exactly(tolerance = 0): ReadoutComparison {
  return (actual, expected, label) => expectValueCloseTo(actual, expected, tolerance, label);
}

function atFloatReadoutPrecision(extraTolerance = 0): ReadoutComparison {
  return (actual, expected, label) => expectFloatReadoutCloseTo(actual, expected, label, extraTolerance);
}

async function verifyResultBandAgainstOracle(
  bandNumber: number,
  expectedAt: SourcePixelOracle,
  compare: ReadoutComparison,
  options: ReadoutProbeOptions = {},
): Promise<string> {
  const probe = options.probe ?? PROBE_PIXEL;
  const dimensions = options.dimensions ?? SCALE10_DIMENSIONS;
  return runAsStoryboardStep(launched.window, `Verify the band ${bandNumber} result readout`, async () => {
    await selectActiveBandNumberInPanel(launched.window, RESULT_PANEL, bandNumber);
    const reported = await readReportedPixelNear(launched.window, RESULT_PANEL, probe, dimensions);
    compare(reported.value, expectedAt(reported.x, reported.y), `band ${bandNumber} readout at (${reported.x}, ${reported.y})`);
    return `band ${bandNumber}: pixel (${reported.x}, ${reported.y}) read ${reported.rawValue}`;
  });
}

// Denoise and the spatial filter need the reported pixel AWAY from the
// modulo-100 ramp wrap, where the ramp is locally linear and a symmetric
// kernel reproduces the centre value.
async function verifySmoothInteriorResultReadout(tolerance: number, label: string): Promise<string> {
  return runAsStoryboardStep(launched.window, label, async () => {
    const reported = await readSmoothInteriorPixel(launched.window, RESULT_PANEL, SCALE10_DIMENSIONS);
    const expected = scale10Value(0, reported.x, reported.y);
    expectValueCloseTo(reported.value, expected, tolerance, label);
    return `pixel (${reported.x}, ${reported.y}) read ${reported.rawValue}, expected ~${expected}`;
  });
}

// --- operation areas ---------------------------------------------------------------

test("invert reads out the exact uint16 complement", async () => {
  test.setTimeout(ONE_APPLY_TEST_TIMEOUT_MS);
  await recordSweepVerdict("operation: Invert", async () => {
    await openOperationScaleStackViaGroupedFiles();
    const applied = await openConfigureAndApplyFromSourcePanel("Invert");
    const oracle = await verifyResultBandAgainstOracle(1, (x, y) => UINT16_MAX - scale10Value(0, x, y), exactly());
    return { ...applied, oracle };
  });
});

test("bit shift by the default 4 multiplies band 1 by 16 exactly", async () => {
  test.setTimeout(ONE_APPLY_TEST_TIMEOUT_MS);
  await recordSweepVerdict("operation: Bit Shift (default +4)", async () => {
    await openOperationScaleStackViaGroupedFiles();
    const applied = await openConfigureAndApplyFromSourcePanel("Bit Shift");
    const oracle = await verifyResultBandAgainstOracle(1, (x, y) => BIT_SHIFT_FACTOR * scale10Value(0, x, y), exactly());
    return { ...applied, oracle };
  });
});

test("brightness & contrast at defaults is the identity", async () => {
  test.setTimeout(ONE_APPLY_TEST_TIMEOUT_MS);
  await recordSweepVerdict("operation: Brightness & Contrast (defaults)", async () => {
    await openOperationScaleStackViaGroupedFiles();
    const applied = await openConfigureAndApplyFromSourcePanel("Brightness & Contrast");
    const oracle = await verifyResultBandAgainstOracle(1, (x, y) => scale10Value(0, x, y), exactly(1));
    return { ...applied, oracle };
  });
});

test("clip by value clamps the whole stack to the absolute bounds", async () => {
  test.setTimeout(ONE_APPLY_TEST_TIMEOUT_MS);
  await recordSweepVerdict("operation: Clip by Value (full stack)", async () => {
    await openOperationScaleStackViaGroupedFiles();
    const applied = await openConfigureAndApplyFromSourcePanel("Clip by Value", configureClipByValue);
    const band1 = await verifyResultBandAgainstOracle(
      1,
      (x, y) => clampToRange(scale10Value(0, x, y), CLIP_LOW, CLIP_HIGH),
      exactly(),
    );
    const topBand = await verifyResultBandAgainstOracle(OPS_TOP_BAND_NUMBER, () => CLIP_HIGH, exactly());
    return { ...applied, oracle: `${band1}; ${topBand}` };
  });
});

async function configureClipByValue(): Promise<void> {
  await selectFullStackScope(launched.window, "Clip by Value");
  await setOperationNumberParameter(launched.window, "Clip by Value", "Clip low", CLIP_LOW);
  await setOperationNumberParameter(launched.window, "Clip by Value", "Clip high", CLIP_HIGH);
}

test("normalize min-max scales the whole stack by one cube-wide range", async () => {
  test.setTimeout(ONE_APPLY_TEST_TIMEOUT_MS);
  await recordSweepVerdict("operation: Normalize (min-max, full stack)", async () => {
    await openOperationScaleStackViaGroupedFiles();
    const applied = await openConfigureAndApplyFromSourcePanel("Normalize", () =>
      selectFullStackScope(launched.window, "Normalize"),
    );
    const band1 = await verifyResultBandAgainstOracle(1, (x, y) => normalizedStackValue(0, x, y), atFloatReadoutPrecision());
    const topBand = await verifyResultBandAgainstOracle(
      OPS_TOP_BAND_NUMBER,
      (x, y) => normalizedStackValue(OPS_TOP_BAND_INDEX, x, y),
      atFloatReadoutPrecision(),
    );
    return { ...applied, oracle: `${band1}; ${topBand}` };
  });
});

function normalizedStackValue(bandIndex: number, x: number, y: number): number {
  return (scale10Value(bandIndex, x, y) - OPS_STACK_MIN) / (OPS_STACK_MAX - OPS_STACK_MIN);
}

test("standardize band-wise centres every band on its own mean and deviation", async () => {
  test.setTimeout(ONE_APPLY_TEST_TIMEOUT_MS);
  await recordSweepVerdict(`operation: Standardize (band-wise, all ${OPS_BAND_COUNT} bands)`, async () => {
    await openOperationScaleStackViaGroupedFiles();
    const applied = await openConfigureAndApplyFromSourcePanel("Standardize", () =>
      selectBandWiseScopeForBands(launched.window, "Standardize", `1-${OPS_BAND_COUNT}`),
    );
    const band1 = await verifyResultBandAgainstOracle(1, standardizedRampValue, atFloatReadoutPrecision(0.001));
    const topBand = await verifyResultBandAgainstOracle(
      OPS_TOP_BAND_NUMBER,
      standardizedRampValue,
      atFloatReadoutPrecision(0.001),
    );
    return { ...applied, oracle: `${band1}; ${topBand}` };
  });
});

// Band-wise standardize cancels each band's base, leaving the same value on
// every band: (s - mean(s)) / std(s).
function standardizedRampValue(x: number, y: number): number {
  return (rampSum(x, y) - RAMP_MEAN) / RAMP_STANDARD_DEVIATION;
}

test("tone curve full image and whole stack both bake the flat-max curve", async () => {
  test.setTimeout(TWO_APPLY_TEST_TIMEOUT_MS);
  await recordSweepVerdict("operation: Contrast Curve (Full image, then Whole stack)", async () => {
    await openOperationScaleStackViaGroupedFiles();
    const fullImage = await openConfigureAndApplyFromSourcePanel("Contrast Curve", () => configureFlatMaxToneCurve(selectFullImageScope));
    const fullImageOracle = await verifyResultBandAgainstOracle(1, () => UINT16_MAX, exactly(1));
    await closeResultPanelAndLetMemorySettle();
    const wholeStack = await openConfigureAndApplyFromSourcePanel("Contrast Curve", () => configureFlatMaxToneCurve(selectWholeStackScope));
    const wholeStackBand1 = await verifyResultBandAgainstOracle(1, () => UINT16_MAX, exactly(1));
    const wholeStackTopBand = await verifyResultBandAgainstOracle(OPS_TOP_BAND_NUMBER, () => UINT16_MAX, exactly(1));
    return {
      fullImageApplyMs: fullImage.applyMs,
      wholeStackApplyMs: wholeStack.applyMs,
      maxUiGapMs: Math.max(fullImage.maxUiGapMs, wholeStack.maxUiGapMs),
      oracle: `${fullImageOracle}; ${wholeStackBand1}; ${wholeStackTopBand}`,
    };
  });
});

async function configureFlatMaxToneCurve(
  selectScope: (page: LaunchedApp["window"], operationLabel: string) => Promise<void>,
): Promise<void> {
  await selectScope(launched.window, "Contrast Curve");
  await setToneCurveAnchorField(launched.window, "New value", UINT16_MAX);
}

test("threshold manual bounds and the Otsu auto cutoff both binarize band 1", async () => {
  test.setTimeout(TWO_APPLY_TEST_TIMEOUT_MS);
  await recordSweepVerdict("operation: Threshold (manual, then Otsu auto)", async () => {
    await openOperationScaleStackViaGroupedFiles();
    const manual = await openConfigureAndApplyFromSourcePanel("Threshold", () =>
      setThresholdBoundField(launched.window, "Lower", THRESHOLD_MANUAL_LOWER_BOUND),
    );
    const manualOracle = await verifyResultBandAgainstOracle(
      1,
      (x, y) => (scale10Value(0, x, y) >= THRESHOLD_MANUAL_LOWER_BOUND ? THRESHOLD_WHITE : THRESHOLD_BLACK),
      exactly(),
    );
    await closeResultPanelAndLetMemorySettle();
    const otsu = await deriveOtsuBoundsAndApply();
    const otsuOracle = await verifyResultBandAgainstOracle(
      1,
      (x, y) => thresholdedByBounds(scale10Value(0, x, y), otsu.lowerBound, otsu.upperBound),
      exactly(),
    );
    return {
      manualApplyMs: manual.applyMs,
      otsuDeriveMs: otsu.deriveMs,
      otsuApplyMs: otsu.applied.applyMs,
      maxUiGapMs: Math.max(manual.maxUiGapMs, otsu.deriveMaxUiGapMs, otsu.applied.maxUiGapMs),
      oracle: `manual ${manualOracle}; otsu [${otsu.lowerBound}, ${otsu.upperBound}] ${otsuOracle}`,
    };
  });
});

function thresholdedByBounds(value: number, lowerBound: number, upperBound: number): number {
  return value >= lowerBound && value <= upperBound ? THRESHOLD_WHITE : THRESHOLD_BLACK;
}

interface OtsuApplyOutcome {
  readonly lowerBound: number;
  readonly upperBound: number;
  readonly deriveMs: number;
  readonly deriveMaxUiGapMs: number;
  readonly applied: AppliedOperation;
}

async function deriveOtsuBoundsAndApply(): Promise<OtsuApplyOutcome> {
  await selectPanel(launched.window, SOURCE_PANEL);
  await openOperation(launched.window, "Threshold");
  await startUiHeartbeat(launched.window);
  const startedAt = Date.now();
  await clickThresholdOtsuAutoButton(launched.window);
  await waitForOtsuLowerBoundToPopulate();
  const deriveMs = Date.now() - startedAt;
  const deriveMaxUiGapMs = await stopUiHeartbeatAndReadMaxGapMs(launched.window);
  expect(deriveMaxUiGapMs, "Otsu derive must stay under the UI-gap threshold").toBeLessThanOrEqual(SCALE10_MAX_UI_GAP_MS);
  const lowerBound = Number.parseFloat(await readThresholdBoundFieldValue(launched.window, "Lower"));
  const upperBound = Number.parseFloat(await readThresholdBoundFieldValue(launched.window, "Upper"));
  const applied = await applyAssertingSweepBudgets("Threshold");
  return { lowerBound, upperBound, deriveMs, deriveMaxUiGapMs, applied };
}

async function waitForOtsuLowerBoundToPopulate(): Promise<void> {
  await expect
    .poll(async () => Number.parseFloat(await readThresholdBoundFieldValue(launched.window, "Lower")), {
      timeout: OTSU_DERIVE_BUDGET_MS,
    })
    .toBeGreaterThan(0);
}

test("percentile clip band-wise and full-stack clamp to the exact cut points", async () => {
  test.setTimeout(TWO_APPLY_TEST_TIMEOUT_MS);
  await recordSweepVerdict("operation: Percentile Clip (band-wise band 1, then full stack)", async () => {
    await openOperationScaleStackViaGroupedFiles();
    const bandWise = await openConfigureAndApplyFromSourcePanel("Percentile Clip", () =>
      selectBandWiseScopeForBands(launched.window, "Percentile Clip", "1"),
    );
    const bandWiseOracle = await verifyBandWisePercentileClipOnBandOne();
    await closeResultPanelAndLetMemorySettle();
    const fullStack = await openConfigureAndApplyFromSourcePanel("Percentile Clip");
    const fullStackOracle = await verifyFullStackPercentileClipOnOuterBands();
    return {
      bandWiseApplyMs: bandWise.applyMs,
      fullStackApplyMs: fullStack.applyMs,
      maxUiGapMs: Math.max(bandWise.maxUiGapMs, fullStack.maxUiGapMs),
      oracle: `band-wise ${bandWiseOracle}; full-stack ${fullStackOracle}`,
    };
  });
});

async function verifyBandWisePercentileClipOnBandOne(): Promise<string> {
  const cuts = computeScale10PercentileCutPoints([1]);
  const oracle = await verifyResultBandAgainstOracle(
    1,
    (x, y) => clampToRange(scale10Value(0, x, y), cuts.lower, cuts.upper),
    atFloatReadoutPrecision(),
  );
  return `cut points [${cuts.lower}, ${cuts.upper}] ${oracle}`;
}

// One cube-wide cut-point pair: band 1 lies entirely below the lower cut and
// the top band entirely above the upper cut, so both bands read the cut points.
async function verifyFullStackPercentileClipOnOuterBands(): Promise<string> {
  const cuts = computeScale10PercentileCutPoints(listOperationScaleBandNumbers());
  const band1 = await verifyResultBandAgainstOracle(
    1,
    (x, y) => clampToRange(scale10Value(0, x, y), cuts.lower, cuts.upper),
    atFloatReadoutPrecision(),
  );
  const topBand = await verifyResultBandAgainstOracle(
    OPS_TOP_BAND_NUMBER,
    (x, y) => clampToRange(scale10Value(OPS_TOP_BAND_INDEX, x, y), cuts.lower, cuts.upper),
    atFloatReadoutPrecision(),
  );
  return `cut points [${cuts.lower}, ${cuts.upper}] ${band1}; ${topBand}`;
}

test("denoise gaussian and median preserve the locally-linear ramp interior", async () => {
  test.setTimeout(TWO_APPLY_TEST_TIMEOUT_MS);
  await recordSweepVerdict("operation: Denoise (gaussian, then median, full stack)", async () => {
    await openOperationScaleStackViaGroupedFiles();
    const gaussian = await openConfigureAndApplyFromSourcePanel("Denoise");
    const gaussianOracle = await verifySmoothInteriorResultReadout(GAUSSIAN_DENOISE_TOLERANCE, "gaussian on the linear ramp");
    await closeResultPanelAndLetMemorySettle();
    const median = await openConfigureAndApplyFromSourcePanel("Denoise", () =>
      setOperationEnumParameter(launched.window, "Denoise", "median"),
    );
    const medianOracle = await verifySmoothInteriorResultReadout(MEDIAN_DENOISE_TOLERANCE, "median on the monotone ramp");
    return {
      gaussianApplyMs: gaussian.applyMs,
      medianApplyMs: median.applyMs,
      maxUiGapMs: Math.max(gaussian.maxUiGapMs, median.maxUiGapMs),
      oracle: `gaussian ${gaussianOracle}; median ${medianOracle}`,
    };
  });
});

test("spatial filter lowpass runs the worker at full spatial scale on band 1", async () => {
  test.setTimeout(ONE_APPLY_TEST_TIMEOUT_MS);
  await recordSweepVerdict("operation: Frequency Filters (lowpass, band-wise band 1)", async () => {
    await openOperationScaleStackViaGroupedFiles();
    const applied = await openConfigureAndApplyFromSourcePanel("Frequency Filters", () =>
      selectBandWiseScopeForBands(launched.window, "Frequency Filters", "1"),
    );
    const oracle = await verifySmoothInteriorResultReadout(SPATIAL_FILTER_TOLERANCE, "lowpass on the linear ramp");
    return { ...applied, oracle };
  });
});

test("spectral derivative reads out the exact 600 band spacing", async () => {
  test.setTimeout(ONE_APPLY_TEST_TIMEOUT_MS);
  await recordSweepVerdict("operation: Spectral Derivative (order 1)", async () => {
    await openOperationScaleStackViaGroupedFiles();
    const applied = await openConfigureAndApplyFromSourcePanel("Spectral Derivative");
    const oracle = await verifyResultBandAgainstOracle(1, () => 600, atFloatReadoutPrecision());
    return { ...applied, oracle };
  });
});

test("false-color composite aliases the assigned bands into the channels", async () => {
  test.setTimeout(ONE_APPLY_TEST_TIMEOUT_MS);
  await recordSweepVerdict(`operation: False-color Composite (bands ${OPS_TOP_BAND_NUMBER}/25/1)`, async () => {
    await openOperationScaleStackViaGroupedFiles();
    const applied = await openConfigureAndApplyFromSourcePanel("False-color Composite", configureFalseColorBands);
    // CT-278: the committed composite renders as one colour image (band 45
    // data in the bright red channel), so sample the canvas FIRST, then flip
    // to the CT-248 channel view to navigate the bands for the readouts.
    await expectResultCanvasShowsContent();
    await toggleChannelView(launched.window, RESULT_PANEL);
    const redChannel = await verifyResultBandAgainstOracle(1, (x, y) => scale10Value(OPS_TOP_BAND_INDEX, x, y), exactly());
    const blueChannel = await verifyResultBandAgainstOracle(3, (x, y) => scale10Value(0, x, y), exactly());
    return { ...applied, oracle: `R ${redChannel}; B ${blueChannel}` };
  });
});

async function configureFalseColorBands(): Promise<void> {
  await setOperationNumberParameter(launched.window, "False-color Composite", "Band R", OPS_TOP_BAND_NUMBER);
  await setOperationNumberParameter(launched.window, "False-color Composite", "Band G", 25);
  await setOperationNumberParameter(launched.window, "False-color Composite", "Band B", 1);
}

async function expectResultCanvasShowsContent(): Promise<void> {
  await expect
    .poll(async () => nonClearPixelFraction(await summarizeCanvasPixels(panelCanvas(launched.window, RESULT_PANEL))))
    .toBeGreaterThan(DISPLAY_NON_CLEAR_FLOOR);
}

test("rotate 90 clockwise and reflect horizontal remap coordinates exactly", async () => {
  test.setTimeout(TWO_APPLY_TEST_TIMEOUT_MS);
  await recordSweepVerdict("operation: Rotate (90 cw), then Flip (horizontal)", async () => {
    await openOperationScaleStackViaGroupedFiles();
    const rotate = await openConfigureAndApplyFromSourcePanel("Rotate");
    const rotateOracle = await verifyResultBandAgainstOracle(1, rotatedNinetyClockwiseValue, exactly(), {
      probe: ROTATED_PROBE_PIXEL,
      dimensions: ROTATED_DIMENSIONS,
    });
    await closeResultPanelAndLetMemorySettle();
    const reflect = await openConfigureAndApplyFromSourcePanel("Flip");
    const reflectOracle = await verifyResultBandAgainstOracle(
      1,
      (x, y) => scale10Value(0, SCALE10_DIMENSIONS.width - 1 - x, y),
      exactly(),
    );
    return {
      rotateApplyMs: rotate.applyMs,
      reflectApplyMs: reflect.applyMs,
      maxUiGapMs: Math.max(rotate.maxUiGapMs, reflect.maxUiGapMs),
      oracle: `rotate ${rotateOracle}; reflect ${reflectOracle}`,
    };
  });
});

// Rotate 90 cw maps source (x, y) to destination (h - 1 - y, x), so the value
// at reported destination (X, Y) came from source (Y, h - 1 - X).
function rotatedNinetyClockwiseValue(reportedX: number, reportedY: number): number {
  return scale10Value(0, reportedY, SCALE10_DIMENSIONS.height - 1 - reportedX);
}

test("crop to region reads back through the exact committed rectangle", async () => {
  test.setTimeout(ONE_APPLY_TEST_TIMEOUT_MS);
  await recordSweepVerdict("operation: Crop to Region (~2000x1600)", async () => {
    await openOperationScaleStackViaGroupedFiles();
    await openOperation(launched.window, "Crop to Region");
    await selectOperationRegionByDrag(launched.window, {
      panelNumber: SOURCE_PANEL,
      operationLabel: "Crop to Region",
      startPixel: OPERATION_REGION.start,
      endPixel: OPERATION_REGION.end,
      imageDimensions: SCALE10_DIMENSIONS,
    });
    const applied = await applyAssertingSweepBudgets("Crop to Region");
    const oracle = await verifyCropAgainstCommittedRectangle();
    return { ...applied, oracle };
  });
});

// The History entry carries the exact committed rectangle ("Crop to (x0, y0) -
// (x1, y1)"), which pins the drag-committed offsets and makes the readout
// exactly computable despite canvas-pixel drag granularity.
async function verifyCropAgainstCommittedRectangle(): Promise<string> {
  const rect = await readCommittedCropRectangleFromHistory();
  const cropDimensions = { width: rect.x1 - rect.x0 + 1, height: rect.y1 - rect.y0 + 1 };
  const probe = { x: Math.floor(cropDimensions.width / 2), y: Math.floor(cropDimensions.height / 2) };
  const oracle = await verifyResultBandAgainstOracle(
    1,
    (x, y) => scale10Value(0, x + rect.x0, y + rect.y0),
    exactly(),
    { probe, dimensions: cropDimensions },
  );
  return `rect (${rect.x0}, ${rect.y0}) - (${rect.x1}, ${rect.y1}); ${oracle}`;
}

interface CropRectangle {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

const CROP_HISTORY_PATTERN = /Crop to \((\d+), (\d+)\) - \((\d+), (\d+)\)/;

async function readCommittedCropRectangleFromHistory(): Promise<CropRectangle> {
  await selectPanel(launched.window, RESULT_PANEL);
  const entries = await readHistoryEntries(launched.window);
  for (const entry of entries) {
    const match = entry.detailLines
      .map((line) => CROP_HISTORY_PATTERN.exec(line))
      .find((candidate) => candidate !== null);
    if (match) return { x0: Number(match[1]), y0: Number(match[2]), x1: Number(match[3]), y1: Number(match[4]) };
  }
  throw new Error(`No crop rectangle found in History: ${JSON.stringify(entries)}`);
}

test("flat-field correction and spectralon calibration divide by the references", async () => {
  test.setTimeout(TWO_APPLY_TEST_TIMEOUT_MS);
  await recordSweepVerdict("operation: Flat-field (file reference), then Spectralon", async () => {
    await openOperationScaleStackViaGroupedFiles();
    const flatField = await openConfigureAndApplyFromSourcePanel("Flat-field Correction", () =>
      chooseFlatFieldReferenceFileThroughDialog(launched.window, FLAT_FIELD_LIGHT_FIELD_LABEL, SCALE10_FLAT_FIELD_PATH),
    );
    const flatFieldOracle = await verifyFlatFieldOnOuterBands();
    await closeResultPanelAndLetMemorySettle();
    const spectralon = await openConfigureAndApplyFromSourcePanel("Spectralon Calibration", configureSpectralonCalibration);
    const spectralonOracle = await verifyResultBandAgainstOracle(
      1,
      (x, y) => scale10Value(0, x, y) / SPECTRALON_REGION_BAND_1_MEAN,
      exactly(SPECTRALON_TOLERANCE),
    );
    return {
      flatFieldApplyMs: flatField.applyMs,
      spectralonApplyMs: spectralon.applyMs,
      maxUiGapMs: Math.max(flatField.maxUiGapMs, spectralon.maxUiGapMs),
      oracle: `flat-field ${flatFieldOracle}; spectralon ${spectralonOracle}`,
    };
  });
});

// Flat-field with no dark reference: out = mean(F) * value / F, where the
// single-band reference F = 500 + rampSum broadcasts across every target band
// and mean(F) = 599 exactly (whole ramp cycles).
async function verifyFlatFieldOnOuterBands(): Promise<string> {
  const band1 = await verifyResultBandAgainstOracle(1, (x, y) => flatFieldedValue(0, x, y), atFloatReadoutPrecision());
  const topBand = await verifyResultBandAgainstOracle(
    OPS_TOP_BAND_NUMBER,
    (x, y) => flatFieldedValue(OPS_TOP_BAND_INDEX, x, y),
    atFloatReadoutPrecision(),
  );
  return `${band1}; ${topBand}`;
}

function flatFieldedValue(bandIndex: number, x: number, y: number): number {
  return (FLAT_FIELD_MEAN * scale10Value(bandIndex, x, y)) / (FLAT_FIELD_BASE + rampSum(x, y));
}

async function configureSpectralonCalibration(): Promise<void> {
  await setOperationNumberParameter(launched.window, "Spectralon Calibration", "Known reflectance", 1);
  await selectOperationRegionByDrag(launched.window, {
    panelNumber: SOURCE_PANEL,
    operationLabel: "Spectralon Calibration",
    startPixel: SPECTRALON_REGION.start,
    endPixel: SPECTRALON_REGION.end,
    imageDimensions: SCALE10_DIMENSIONS,
  });
}

// --- the memory-budget guard at full scale ------------------------------------------

// Must match OPERATION_MEMORY_REFUSAL_MESSAGE in
// src/renderer/src/lib/image/raster-memory-budget.ts - duplicated here on
// purpose so the committed sweep pins the user-facing copy.
const MEMORY_REFUSAL_COPY =
  "There is not enough memory for this operation with the current panels open. " +
  "Close panels you no longer need, use a band-wise scope, or crop the stack and try again.";
const REFUSAL_TOAST_TIMEOUT_MS = 60_000;

test("the full 100-band stack refuses over-pool applies with the exact in-vocabulary copy", async () => {
  test.setTimeout(ONE_APPLY_TEST_TIMEOUT_MS);
  await recordSweepVerdict("guard: over-pool applies refused at 100 bands (CT-239 memory budget)", async () => {
    await openFullScaleStackViaGroupedFiles();
    const normalizeRefusal = await expectApplyRefusedForMemory("Normalize", () =>
      selectFullStackScope(launched.window, "Normalize"),
    );
    const bitShiftRefusal = await expectApplyRefusedForMemory("Bit Shift");
    const oracle = await verifySourceBandOneStillReadsTheOracle();
    return { normalizeRefusal, bitShiftRefusal, oracle };
  });
});

// A refused apply must surface the exact copy, reserve NO result panel, and
// leave the source untouched; the refusal fires before any allocation, so it
// lands within seconds even at full scale.
async function expectApplyRefusedForMemory(
  operationLabel: string,
  configure?: () => Promise<void>,
): Promise<string> {
  return runAsStoryboardStep(launched.window, `Expect ${operationLabel} to refuse for memory`, async () => {
    const panelsBefore = await countGridPanels(launched.window);
    await selectPanel(launched.window, SOURCE_PANEL);
    await openOperation(launched.window, operationLabel);
    if (configure) await configure();
    await operationPanel(launched.window, operationLabel).getByRole("button", { name: "Apply", exact: true }).click();
    await expectRefusalToastNamingMemory(operationLabel);
    expect(await countGridPanels(launched.window), "a refused apply must not reserve a result panel").toBe(panelsBefore);
    await expectNoRawAllocationFailureToast(launched.window);
    return `${operationLabel} refused with the in-vocabulary copy`;
  });
}

async function expectRefusalToastNamingMemory(operationLabel: string): Promise<void> {
  await expect
    .poll(async () => (await readVisibleToastTexts(launched.window)).join(" | "), {
      timeout: REFUSAL_TOAST_TIMEOUT_MS,
    })
    .toContain(`${operationLabel} failed: ${MEMORY_REFUSAL_COPY}`);
}

async function verifySourceBandOneStillReadsTheOracle(): Promise<string> {
  const reported = await readReportedPixelNear(launched.window, SOURCE_PANEL, PROBE_PIXEL, SCALE10_DIMENSIONS);
  expectValueCloseTo(reported.value, scale10Value(0, reported.x, reported.y), 0, "source band 1 after refusals");
  return `source pixel (${reported.x}, ${reported.y}) still reads ${reported.value}`;
}
