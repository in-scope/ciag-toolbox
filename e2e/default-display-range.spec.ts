import { expect, test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { nonClearPixelFraction, summarizeCanvasPixels } from "./support/canvas-pixels";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperationInPlace,
  expectMetadataDataTypeAndDimensions,
  expectNormalizedViewingEnabled,
  historyEntryCount,
  loadFixtureAsStack,
  openOperation,
  panelCanvas,
  selectActiveBandNumber,
  selectFullStackScope,
  selectPanel,
  toggleNormalizedViewing,
} from "./support/page-objects";

// CT-148 / manual section 15 (CT-089): the DEFAULT display convention maps integer pixels
// across the DATA-TYPE range (uint16 -> 0..65535), NOT an auto-stretch. So the
// 12-bit-in-uint16 fixture (band-0 values 100..250 over a 0..65535 window) renders near-black,
// and a Bit Shift by 4 (x16) visibly brightens it instead of being hidden by an auto-stretch.
// Toggling Normalized viewing ON instead stretches the band's own min/max to the screen (a
// display-only change that records no History entry), and an operation-produced float32 stack
// defaults to a [0,1] display window, so its [0,1] values render visibly where the same integer
// magnitudes rendered dark under the data-type window.
//
// FIXTURE SUBSTITUTION (no E2E-BUG, testFailureProtocol step 1): the manual brightens the
// low-contrast PNG, but PNG/JPG load through the browser decode path as an image-bitmap with no
// per-band raster, so operations cannot transform them. The committed multi-band uint16 raster
// (multiband-12bit.tif) is the display-convention oracle: its documented integer band values map
// to known, near-black-or-visible canvas brightness under each display window.

const PANEL = 1;
const BIT_SHIFT = "Bit Shift";
const NORMALIZE = "Normalize";
const FLOAT32 = "float32";
const MID_RANGE_BAND_NUMBER = 2;
const NEAR_BLACK_FRACTION_CEILING = 0.02;
const BRIGHTENED_FRACTION_FLOOR = 0.05;

test("the 12-bit fixture renders dark by default and Bit Shift visibly brightens it", async () => {
  const app = await launchToolboxApp();
  try {
    await loadFixtureAsStack(app.window, multiBandTiff.fileName);
    await expectPanelRendersNearBlack(app, PANEL);
    const darkFraction = await panelNonClearFraction(app, PANEL);
    await applyBitShiftInPlace(app);
    await expectPanelBrightenedToVisible(app, PANEL);
    expect(await panelNonClearFraction(app, PANEL)).toBeGreaterThan(darkFraction);
  } finally {
    await closeToolboxApp(app);
  }
});

test("toggling Normalized viewing stretches the band min/max and records no History entry", async () => {
  const app = await launchToolboxApp();
  try {
    await loadFixtureAsStack(app.window, multiBandTiff.fileName);
    await expectPanelRendersNearBlack(app, PANEL);
    await expect(historyEntryCount(app.window)).resolves.toBe(0);
    await toggleNormalizedViewing(app.window, PANEL);
    await expectNormalizedViewingEnabled(app.window, PANEL, true);
    await expectPanelBrightenedToVisible(app, PANEL);
    await expect(historyEntryCount(app.window)).resolves.toBe(0);
  } finally {
    await closeToolboxApp(app);
  }
});

test("an operation-produced float32 stack defaults to a [0,1] display window", async () => {
  const app = await launchToolboxApp();
  try {
    await loadFixtureAsStack(app.window, multiBandTiff.fileName);
    await selectActiveBandNumber(app.window, MID_RANGE_BAND_NUMBER);
    await expectPanelRendersNearBlack(app, PANEL);
    await normalizeFullCubeInPlace(app);
    await expectStackBecameFloat32(app);
    await selectActiveBandNumber(app.window, MID_RANGE_BAND_NUMBER);
    await expectPanelBrightenedToVisible(app, PANEL);
  } finally {
    await closeToolboxApp(app);
  }
});

async function applyBitShiftInPlace(app: LaunchedApp): Promise<void> {
  await selectPanel(app.window, PANEL);
  await openOperation(app.window, BIT_SHIFT);
  await applyOperationInPlace(app.window, BIT_SHIFT);
}

async function normalizeFullCubeInPlace(app: LaunchedApp): Promise<void> {
  await selectPanel(app.window, PANEL);
  await openOperation(app.window, NORMALIZE);
  await selectFullStackScope(app.window, NORMALIZE);
  await applyOperationInPlace(app.window, NORMALIZE);
}

async function expectStackBecameFloat32(app: LaunchedApp): Promise<void> {
  await expectMetadataDataTypeAndDimensions(app.window, {
    dataType: FLOAT32,
    width: multiBandTiff.width,
    height: multiBandTiff.height,
  });
}

async function expectPanelRendersNearBlack(app: LaunchedApp, panelNumber: number): Promise<void> {
  await expect
    .poll(async () => panelNonClearFraction(app, panelNumber))
    .toBeLessThan(NEAR_BLACK_FRACTION_CEILING);
}

async function expectPanelBrightenedToVisible(app: LaunchedApp, panelNumber: number): Promise<void> {
  await expect
    .poll(async () => panelNonClearFraction(app, panelNumber))
    .toBeGreaterThan(BRIGHTENED_FRACTION_FLOOR);
  const summary = await summarizeCanvasPixels(panelCanvas(app.window, panelNumber));
  expect(summary.distinctColorCount).toBeGreaterThan(1);
}

async function panelNonClearFraction(app: LaunchedApp, panelNumber: number): Promise<number> {
  return nonClearPixelFraction(await summarizeCanvasPixels(panelCanvas(app.window, panelNumber)));
}
