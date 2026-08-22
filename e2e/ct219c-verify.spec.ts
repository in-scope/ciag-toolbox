import { appendFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import { closeToolboxApp, launchToolboxApp, type LaunchedApp } from "./support/launch-app";
import { openOperation, selectPanel } from "./support/page-objects";
import { panelCell } from "./support/panels";
import {
  applyOperationWithBudget,
  AUDIT_DIRECTORY,
  expectValueCloseTo,
  openCaptureFromDisk,
  readReportedPixelNear,
  REFERENCE_DIMENSIONS,
  REFERENCE_STACK_PATH,
  referenceValue,
  type ReportedPixel,
} from "./scale-audit.support";

// CT-219c at-scale verification (SCRATCH, NEVER COMMITTED, per the CT-219
// precedent): full-stack Percentile Clip on the 8000x6000x16 uint16 reference
// stack must complete with visible determinate progress and exact cut points
// instead of toasting "Array buffer allocation failed".
//
// Analytic oracle: value(band b, x, y) = b*1000 + (x%100) + (y%100), so the
// whole-stack multiset is 16 shifted triangular distributions over the residue
// sum s with count(s) = 4800 * (s <= 99 ? s + 1 : 199 - s), and the numpy
// linear percentile is computable exactly without reading the file. For the
// default 2/98 bounds that gives lower cut 1079 and upper cut 16119.

const PERCENTILE_CLIP = "Percentile Clip";
const VALUES_PER_BAND = 8000 * 6000;
const TOTAL_VALUES = VALUES_PER_BAND * 16;
const PAIRS_PER_RESIDUE_SUM = 80 * 60;

function kthSmallestReferenceValue(k: number): number {
  const bandIndex = Math.floor(k / VALUES_PER_BAND);
  const withinBand = k - bandIndex * VALUES_PER_BAND;
  let cumulative = 0;
  for (let residueSum = 0; residueSum <= 198; residueSum += 1) {
    cumulative += PAIRS_PER_RESIDUE_SUM * (residueSum <= 99 ? residueSum + 1 : 199 - residueSum);
    if (cumulative > withinBand) return (bandIndex + 1) * 1000 + residueSum;
  }
  throw new Error(`rank ${k} out of range`);
}

function wholeStackCutPointAtPercentile(percentile: number): number {
  const rank = (percentile / 100) * (TOTAL_VALUES - 1);
  const lowerIndex = Math.floor(rank);
  const lower = kthSmallestReferenceValue(lowerIndex);
  const upper = kthSmallestReferenceValue(Math.min(lowerIndex + 1, TOTAL_VALUES - 1));
  return lower + (rank - lowerIndex) * (upper - lower);
}

const LOWER_CUT = wholeStackCutPointAtPercentile(2);
const UPPER_CUT = wholeStackCutPointAtPercentile(98);

let launched: LaunchedApp;

test.beforeEach(async () => {
  test.setTimeout(30 * 60_000);
  launched = await launchToolboxApp();
});

test.afterEach(async () => {
  try {
    await closeToolboxApp(launched);
  } catch {
    await launched.app.close().catch(() => undefined);
  }
});

async function selectPanelBandNumber(panelNumber: number, bandNumber: number): Promise<void> {
  const input = panelCell(launched.window, panelNumber).getByRole("textbox", {
    name: "Go to band number",
  });
  await input.fill(String(bandNumber));
  await input.press("Enter");
}

function logVerifyEvidence(entry: Record<string, unknown>): void {
  const line = JSON.stringify({ recordedAt: new Date().toISOString(), ...entry });
  appendFileSync(join(AUDIT_DIRECTORY, "ct219c-verify.log"), `${line}\n`);
  console.log(`CT219C ${line}`);
}

// Hover targets sweep a whole 100x100 ramp cell diagonally, so the REPORTED
// residue sums (which track the targets within a bounded fit-view mapping
// offset) are guaranteed to visit every residue window regardless of where an
// individual hover lands; clamped-vs-unclamped expectations are then decided
// from the actual reported coordinates.
const DIAGONAL_SWEEP_TARGETS: ReadonlyArray<{ x: number; y: number }> = Array.from(
  { length: 20 },
  (_unused, step) => ({ x: 2400 + step * 5, y: 1800 + step * 5 }),
);

async function probeUntilResidueSum(
  panelNumber: number,
  residueSumSatisfies: (residueSum: number) => boolean,
): Promise<ReportedPixel> {
  const seen: string[] = [];
  for (const target of DIAGONAL_SWEEP_TARGETS) {
    const reported = await readReportedPixelNear(
      launched.window,
      panelNumber,
      target,
      REFERENCE_DIMENSIONS,
    );
    if (residueSumSatisfies((reported.x % 100) + (reported.y % 100))) return reported;
    seen.push(`(${reported.x}, ${reported.y})`);
  }
  throw new Error(`No probe landed on a pixel with the required residue sum; saw ${seen.join(" ")}`);
}

test("full-stack percentile clip completes at reference scale with progress and exact cut points", async () => {
  expect(LOWER_CUT).toBe(1079);
  expect(UPPER_CUT).toBe(16119);

  const loadMs = await openCaptureFromDisk(launched.window, REFERENCE_STACK_PATH, 5 * 60_000);
  await selectPanel(launched.window, 1);

  await openOperation(launched.window, PERCENTILE_CLIP);
  const timing = await applyOperationWithBudget(launched.window, PERCENTILE_CLIP, 12 * 60_000);
  logVerifyEvidence({
    loadMs,
    applyMs: timing.applyMs,
    maxUiGapMs: timing.maxUiGapMs,
    sawDeterminateProgressBar: timing.sawDeterminateProgressBar,
  });
  expect(timing.sawDeterminateProgressBar).toBe(true);
  expect(timing.maxUiGapMs).toBeLessThan(5000);

  // Band 1, below the lower cut: a pixel with residue sum < 79 reads exactly 1079.
  const clampedLow = await probeUntilResidueSum(2, (residueSum) => residueSum < 79);
  expectValueCloseTo(clampedLow.value, LOWER_CUT, 0.001, "band 1 clamped-low pixel");

  // Band 1, inside the window: an untouched pixel keeps its source value.
  const untouched = await probeUntilResidueSum(
    2,
    (residueSum) => residueSum > 79 && residueSum < 120,
  );
  expectValueCloseTo(
    untouched.value,
    referenceValue(0, untouched.x, untouched.y),
    0.001,
    "band 1 untouched pixel",
  );

  // Band 16 on BOTH panels (navigators scoped per panel cell): the source read
  // checks loader integrity against the formula, the result read checks the
  // clamp; a residue sum > 120 on the result reads exactly 16119.
  await selectPanelBandNumber(1, 16);
  await selectPanelBandNumber(2, 16);
  const sourceHigh = await probeUntilResidueSum(1, (residueSum) => residueSum > 120);
  logVerifyEvidence({ sourceHigh, sourceExpected: referenceValue(15, sourceHigh.x, sourceHigh.y) });
  const clampedHigh = await probeUntilResidueSum(2, (residueSum) => residueSum > 120);
  const resultLowResidue = await probeUntilResidueSum(2, (residueSum) => residueSum < 119);
  logVerifyEvidence({
    clampedLow,
    untouched,
    clampedHigh,
    resultLowResidue,
    resultLowResidueExpected: Math.min(
      UPPER_CUT,
      Math.max(LOWER_CUT, referenceValue(15, resultLowResidue.x, resultLowResidue.y)),
    ),
    lowerCut: LOWER_CUT,
    upperCut: UPPER_CUT,
  });
  expectValueCloseTo(
    sourceHigh.value,
    referenceValue(15, sourceHigh.x, sourceHigh.y),
    0.001,
    "band 16 source pixel (loader integrity)",
  );
  // The status bar renders float32 values at this magnitude with 4 significant
  // digits ("1.612e+4"), so the readout resolution is 10; the EXACT 16119 cut
  // is pinned by the full-scale vitest scratch run and the unit equivalences.
  expectValueCloseTo(clampedHigh.value, UPPER_CUT, 5, "band 16 clamped-high pixel");
  expectValueCloseTo(
    resultLowResidue.value,
    Math.min(UPPER_CUT, Math.max(LOWER_CUT, referenceValue(15, resultLowResidue.x, resultLowResidue.y))),
    5,
    "band 16 in-window pixel",
  );
});
