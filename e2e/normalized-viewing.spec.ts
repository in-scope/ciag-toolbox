import { test, expect } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { nonClearPixelFraction, summarizeCanvasPixels } from "./support/canvas-pixels";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  expectNormalizedViewingEnabled,
  historyEntryCount,
  loadFixtureAsStack,
  panelCanvas,
  readPixelValueAt,
  selectGridLayout,
  toggleNormalizedViewing,
  type PixelDimensions,
} from "./support/page-objects";

// Manual test script sections 9.3 / 15.3 (CT-083 / CT-089): the "Normalized viewing"
// toggle is a per-panel, DISPLAY-ONLY feature. Toggling it stretches the band's actual
// min/max to the screen range, so a 12-bit-in-uint16 stack (which renders near-black by
// default) brightens dramatically, but the underlying DATA never changes: the pixel
// readout reports the same true values and no History entry is recorded. The state lives
// per panel, so toggling one panel leaves the others untouched and survives a grid layout
// change.

const MULTIBAND_DIMENSIONS: PixelDimensions = {
  width: multiBandTiff.width,
  height: multiBandTiff.height,
};

const FIRST_BAND_VALUE_AT_ORIGIN = readFirstBandValueAtOrigin();
const NEAR_BLACK_FRACTION_CEILING = 0.02;
const BRIGHTENED_FRACTION_FLOOR = 0.05;

function readFirstBandValueAtOrigin(): number {
  const originValue = multiBandTiff.samplePixels[0]?.valuesPerBand[0];
  if (originValue === undefined) throw new Error("multiband fixture is missing its (0,0) sample");
  return originValue;
}

test("toggling normalized viewing brightens the panel without changing data or History", async () => {
  const app = await launchToolboxApp();
  try {
    await loadFixtureAsStack(app.window, multiBandTiff.fileName);
    await expectPanelRendersNearBlackByDefault(app, 1);
    await assertOriginPixelReadsItsKnownValue(app, 1);
    await expect(historyEntryCount(app.window)).resolves.toBe(0);
    await toggleNormalizedViewing(app.window, 1);
    await expectNormalizedViewingEnabled(app.window, 1, true);
    await expectPanelToHaveBrightened(app, 1);
    await assertOriginPixelReadsItsKnownValue(app, 1);
    await expect(historyEntryCount(app.window)).resolves.toBe(0);
  } finally {
    await closeToolboxApp(app);
  }
});

test("normalized viewing is per-panel and survives a grid layout change", async () => {
  const app = await launchToolboxApp();
  try {
    await loadSameFixtureIntoTwoPanels(app);
    await toggleNormalizedViewing(app.window, 1);
    await expectOnlyFirstPanelNormalized(app);
    await selectGridLayout(app.window, "2x2");
    await expectOnlyFirstPanelNormalized(app);
  } finally {
    await closeToolboxApp(app);
  }
});

async function loadSameFixtureIntoTwoPanels(app: LaunchedApp): Promise<void> {
  await selectGridLayout(app.window, "1x2");
  await loadFixtureAsStack(app.window, multiBandTiff.fileName);
  await loadFixtureAsStack(app.window, multiBandTiff.fileName);
}

async function expectOnlyFirstPanelNormalized(app: LaunchedApp): Promise<void> {
  await expectNormalizedViewingEnabled(app.window, 1, true);
  await expectNormalizedViewingEnabled(app.window, 2, false);
}

async function assertOriginPixelReadsItsKnownValue(
  app: LaunchedApp,
  panelNumber: number,
): Promise<void> {
  const readout = await readPixelValueAt(app.window, panelNumber, 0, 0, MULTIBAND_DIMENSIONS);
  expect(Number.parseInt(readout.value, 10)).toBe(FIRST_BAND_VALUE_AT_ORIGIN);
}

async function expectPanelRendersNearBlackByDefault(
  app: LaunchedApp,
  panelNumber: number,
): Promise<void> {
  const canvas = panelCanvas(app.window, panelNumber);
  await expect
    .poll(async () => nonClearPixelFraction(await summarizeCanvasPixels(canvas)))
    .toBeLessThan(NEAR_BLACK_FRACTION_CEILING);
}

async function expectPanelToHaveBrightened(
  app: LaunchedApp,
  panelNumber: number,
): Promise<void> {
  const canvas = panelCanvas(app.window, panelNumber);
  await expect
    .poll(async () => nonClearPixelFraction(await summarizeCanvasPixels(canvas)))
    .toBeGreaterThan(BRIGHTENED_FRACTION_FLOOR);
  const summary = await summarizeCanvasPixels(canvas);
  expect(summary.distinctColorCount).toBeGreaterThan(1);
}
