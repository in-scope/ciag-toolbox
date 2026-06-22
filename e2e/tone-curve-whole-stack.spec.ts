import { expect, test } from "@playwright/test";

import { lowContrastGrayPng, multiBandTiff } from "./fixtures/fixture-manifest";
import type { PixelDimensions } from "./support/page-objects";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperationInPlace,
  applyScopeRadio,
  dragToneCurveEndpointTo,
  expectHistoryToRecordOperation,
  expectToneCurveOpensWithTwoEndpoints,
  FULL_IMAGE_SCOPE_LABEL,
  historyEntryCount,
  loadFixtureAsStack,
  nonClearPixelFraction,
  openOperation,
  panelCanvas,
  readPixelValueAt,
  selectActiveBandNumber,
  selectPanel,
  selectWholeStackScope,
  summarizeCanvasPixels,
  TONE_CURVE_LABEL,
  WHOLE_STACK_SCOPE_LABEL,
} from "./support/page-objects";

// CT-192: the tone curve's "Whole stack" scope applies one curve SHAPE to every band,
// each band normalized by its own min/max, so every band gets the same contrast shaping
// (Full image only touches the viewed band). The scope is display-only until Apply and is
// recorded in History. A single-band stack hides "Whole stack" (it would coincide with
// "Full image"), following CT-189.
//
// Fixture multiband-12bit.tif: band N = base[N] + index*10, index = y*4 + x, with bases
// [100, 800, 1600]; so band 0 spans [100, 250], band 1 [800, 950], band 2 [1600, 1750].

const PANEL = 1;
const FOUR_BY_FOUR: PixelDimensions = { width: multiBandTiff.width, height: multiBandTiff.height };

let launched: LaunchedApp;

function bandValueAt(bandBase: number, x: number, y: number): number {
  return bandBase + (y * multiBandTiff.width + x) * 10;
}

test.beforeEach(async () => {
  launched = await launchToolboxApp();
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("whole-stack tone curve changes a band other than the viewed band and records the scope", async () => {
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, PANEL);
  await openOperation(launched.window, TONE_CURVE_LABEL);
  await expectToneCurveOpensWithTwoEndpoints(launched.window);
  await selectWholeStackScope(launched.window, TONE_CURVE_LABEL);
  await liftTheBlackPointSoEveryBandBrightens();
  await applyWholeStackCurveAndAssertHistory();
  await expectViewedBandChanged();
  await expectNonViewedBandChanged();
});

test("the whole-stack preview is display-only until Apply", async () => {
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, PANEL);
  await openOperation(launched.window, TONE_CURVE_LABEL);
  await expectToneCurveOpensWithTwoEndpoints(launched.window);
  await selectWholeStackScope(launched.window, TONE_CURVE_LABEL);
  const baselineFraction = await waitForPreviewFractionToSettle();
  await liftTheBlackPointSoEveryBandBrightens();
  await expectPreviewBrightenedAbove(baselineFraction);
  await expectViewedBandReadoutUnchanged();
});

test("the Whole stack scope is hidden for a single-band stack and shown for a multi-band stack", async () => {
  await loadFixtureAsStack(launched.window, lowContrastGrayPng.fileName);
  await selectPanel(launched.window, PANEL);
  await openOperation(launched.window, TONE_CURVE_LABEL);
  await expect(applyScopeRadio(launched.window, TONE_CURVE_LABEL, WHOLE_STACK_SCOPE_LABEL)).toHaveCount(0);
  await expect(applyScopeRadio(launched.window, TONE_CURVE_LABEL, FULL_IMAGE_SCOPE_LABEL)).toBeVisible();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, 2);
  await openOperation(launched.window, TONE_CURVE_LABEL);
  await expect(applyScopeRadio(launched.window, TONE_CURVE_LABEL, WHOLE_STACK_SCOPE_LABEL)).toBeVisible();
  await expect(applyScopeRadio(launched.window, TONE_CURVE_LABEL, FULL_IMAGE_SCOPE_LABEL)).toBeVisible();
});

async function liftTheBlackPointSoEveryBandBrightens(): Promise<void> {
  await dragToneCurveEndpointTo(launched.window, "left", -0.2, -0.2);
}

async function applyWholeStackCurveAndAssertHistory(): Promise<void> {
  await applyOperationInPlace(launched.window, TONE_CURVE_LABEL);
  expect(await historyEntryCount(launched.window)).toBe(1);
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: TONE_CURVE_LABEL,
    detailSubstrings: [WHOLE_STACK_SCOPE_LABEL],
  });
}

async function expectViewedBandChanged(): Promise<void> {
  await selectActiveBandNumber(launched.window, 1);
  const readout = await readPixelValueAt(launched.window, PANEL, 0, 0, FOUR_BY_FOUR);
  expect(Number.parseFloat(readout.value)).not.toBe(bandValueAt(100, 0, 0));
}

async function expectNonViewedBandChanged(): Promise<void> {
  await selectActiveBandNumber(launched.window, 3);
  const raw = bandValueAt(1600, 3, 3);
  const readout = await readPixelValueAt(launched.window, PANEL, 3, 3, FOUR_BY_FOUR);
  const value = Number.parseFloat(readout.value);
  expect(value).not.toBe(raw);
  expect(value).toBeGreaterThan(raw);
}

async function expectViewedBandReadoutUnchanged(): Promise<void> {
  const readout = await readPixelValueAt(launched.window, PANEL, 0, 0, FOUR_BY_FOUR);
  expect(Number.parseFloat(readout.value)).toBe(bandValueAt(100, 0, 0));
}

async function waitForPreviewFractionToSettle(): Promise<number> {
  await launched.window.waitForTimeout(200);
  return panelNonClearFraction();
}

async function expectPreviewBrightenedAbove(baselineFraction: number): Promise<void> {
  await expect.poll(() => panelNonClearFraction()).toBeGreaterThan(baselineFraction + 0.1);
}

function panelNonClearFraction(): Promise<number> {
  return summarizeCanvasPixels(panelCanvas(launched.window, PANEL)).then(nonClearPixelFraction);
}
