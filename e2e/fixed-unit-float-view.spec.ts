import { test, expect } from "@playwright/test";

import { nonClearPixelFraction, summarizeCanvasPixels } from "./support/canvas-pixels";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  expectFixedUnitFloatViewEnabled,
  historyEntryCount,
  loadImageFromAbsolutePath,
  panelCanvas,
  readPixelValueAt,
  toggleFixedUnitFloatView,
  writeTemporaryMultiBandFloat32Tiff,
  type PixelDimensions,
} from "./support/page-objects";

// CT-193: a per-panel, DISPLAY-ONLY toggle. By default a float band whose values leave
// [0,1] auto-stretches to its own extents on open (CT-161), so a stack of mostly-negative
// values with a lone bright outlier renders as a spread of grays (most pixels non-black).
// Turning the "Fixed [0,1] float view" toggle ON pins the display to the fixed [0,1]
// window instead: values below 0 clamp to black and values above 1 clamp to white, so the
// mostly-negative band collapses to near-black. That display change is observable via
// canvas-pixel sampling, while the pixel-readout oracle reports the SAME true float values
// and no History entry is recorded.

const FIXTURE_DIMENSIONS: PixelDimensions = { width: 4, height: 4 };
const PANEL = 1;
const KNOWN_NEGATIVE_ORIGIN_VALUE = -3;
const AUTO_STRETCH_FRACTION_FLOOR = 0.5;
const FIXED_WINDOW_FRACTION_MARGIN = 0.25;

// 15 values spread across the negative range (-3 .. -0.2, all < 0) plus one bright outlier
// (+2, > 1) at the bottom-right pixel. Auto-stretch maps the whole range across [0,1] so
// most pixels light up; the fixed [0,1] window clamps every negative pixel to black.
function buildMostlyNegativeFloatBandWithBrightOutlier(): number[] {
  const negatives = Array.from({ length: 15 }, (_unused, index) => -3 + index * 0.2);
  return [...negatives, 2];
}

async function writeMostlyNegativeFloatFixture(): Promise<string> {
  return writeTemporaryMultiBandFloat32Tiff({
    ...FIXTURE_DIMENSIONS,
    bands: [buildMostlyNegativeFloatBandWithBrightOutlier()],
  });
}

test("fixed [0,1] float view clamps out-of-range float without changing data or History", async () => {
  const app = await launchToolboxApp();
  try {
    await loadImageFromAbsolutePath(app.window, await writeMostlyNegativeFloatFixture());
    const autoStretchFraction = await readPanelNonClearFraction(app, PANEL);
    expect(autoStretchFraction).toBeGreaterThan(AUTO_STRETCH_FRACTION_FLOOR);
    const originBeforeToggle = await readOriginFloatReadout(app, PANEL);
    expect(Number.parseFloat(originBeforeToggle)).toBeCloseTo(KNOWN_NEGATIVE_ORIGIN_VALUE, 4);
    await expect(historyEntryCount(app.window)).resolves.toBe(0);

    await toggleFixedUnitFloatView(app.window, PANEL);
    await expectFixedUnitFloatViewEnabled(app.window, PANEL, true);
    await expectPanelToHaveCollapsedTowardBlack(app, PANEL, autoStretchFraction);
    expect(await readOriginFloatReadout(app, PANEL)).toBe(originBeforeToggle);
    await expect(historyEntryCount(app.window)).resolves.toBe(0);

    await toggleFixedUnitFloatView(app.window, PANEL);
    await expectFixedUnitFloatViewEnabled(app.window, PANEL, false);
    await expectPanelToHaveAutoStretchedAgain(app, PANEL);
  } finally {
    await closeToolboxApp(app);
  }
});

async function readPanelNonClearFraction(app: LaunchedApp, panelNumber: number): Promise<number> {
  return nonClearPixelFraction(await summarizeCanvasPixels(panelCanvas(app.window, panelNumber)));
}

async function readOriginFloatReadout(app: LaunchedApp, panelNumber: number): Promise<string> {
  const readout = await readPixelValueAt(app.window, panelNumber, 0, 0, FIXTURE_DIMENSIONS);
  return readout.value;
}

async function expectPanelToHaveCollapsedTowardBlack(
  app: LaunchedApp,
  panelNumber: number,
  autoStretchFraction: number,
): Promise<void> {
  const canvas = panelCanvas(app.window, panelNumber);
  await expect
    .poll(async () => nonClearPixelFraction(await summarizeCanvasPixels(canvas)))
    .toBeLessThan(autoStretchFraction - FIXED_WINDOW_FRACTION_MARGIN);
}

async function expectPanelToHaveAutoStretchedAgain(
  app: LaunchedApp,
  panelNumber: number,
): Promise<void> {
  const canvas = panelCanvas(app.window, panelNumber);
  await expect
    .poll(async () => nonClearPixelFraction(await summarizeCanvasPixels(canvas)))
    .toBeGreaterThan(AUTO_STRETCH_FRACTION_FLOOR);
}
