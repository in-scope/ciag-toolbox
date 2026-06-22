import { expect, test } from "@playwright/test";

import { lowContrastGrayPng } from "./fixtures/fixture-manifest";
import type { PixelDimensions } from "./support/page-objects";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperationInPlace,
  averageNonClearCanvasColor,
  cancelOperation,
  expectHistoryToRecordOperation,
  expectPixelReadoutToEqual,
  historyEntryCount,
  loadFixtureAsStack,
  openOperation,
  panelCanvas,
  selectPanel,
} from "./support/page-objects";
import {
  BRIGHTNESS_CONTRAST_LABEL,
  BRIGHTNESS_SLIDER_LABEL,
  setBrightnessContrastSlider,
} from "./support/brightness-contrast-controls";

// CT-186: the Brightness & Contrast PREVIEW is display-only, exactly like the tone-curve
// preview. Dragging the Brightness slider uploads a small GPU lookup table and enables the
// shader's single-band display-LUT branch instead of re-baking the band into a new raster.
// So a drag must (a) BRIGHTEN what the canvas paints while leaving the pixel-readout DATA
// value untouched, and (b) only on Apply does the DATA change and a History entry land.
// Closing the panel clears the slider buffer, disabling the LUT (the untouched source
// returns). low-contrast-gray.png is a 4x4 uint8 mid-grey ramp (100..130) so its rendered
// pixels sit well above the clear colour, making the average rendered brightness the ideal
// display-changed oracle, with an exact (0,0)=100 integer readout for the data-unchanged check.

const PANEL = 1;
const FIXTURE = lowContrastGrayPng;
const DIMENSIONS: PixelDimensions = { width: FIXTURE.width, height: FIXTURE.height };
const TOP_LEFT_RAW_VALUE = 100;
const BRIGHTNESS_PERCENT = 40;
const UINT8_MAX = 255;
const BRIGHTENED_TOP_LEFT_VALUE = TOP_LEFT_RAW_VALUE + (BRIGHTNESS_PERCENT / 100) * UINT8_MAX;
const MIN_BRIGHTENING_DELTA = 40;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, FIXTURE.fileName);
  await selectPanel(launched.window, PANEL);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("dragging the brightness slider previews live (display brightens, data unchanged, no History)", async () => {
  await openOperation(launched.window, BRIGHTNESS_CONTRAST_LABEL);
  const baselineBrightness = await settledAverageRenderedBrightness();
  await setBrightnessContrastSlider(launched.window, BRIGHTNESS_SLIDER_LABEL, BRIGHTNESS_PERCENT);
  await expectRenderedBrightnessIncreasedAbove(baselineBrightness);
  await expectTopLeftReadout(TOP_LEFT_RAW_VALUE);
  expect(await historyEntryCount(launched.window)).toBe(0);
});

test("Apply bakes the previewed brightness into the data and records one History entry", async () => {
  await openOperation(launched.window, BRIGHTNESS_CONTRAST_LABEL);
  await setBrightnessContrastSlider(launched.window, BRIGHTNESS_SLIDER_LABEL, BRIGHTNESS_PERCENT);
  await expectTopLeftReadout(TOP_LEFT_RAW_VALUE);
  await applyOperationInPlace(launched.window, BRIGHTNESS_CONTRAST_LABEL);
  await expectTopLeftReadout(BRIGHTENED_TOP_LEFT_VALUE);
  expect(await historyEntryCount(launched.window)).toBe(1);
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: BRIGHTNESS_CONTRAST_LABEL,
    detailSubstrings: ["Brightness +40%"],
  });
});

test("closing the panel clears the preview LUT and restores the untouched render", async () => {
  await openOperation(launched.window, BRIGHTNESS_CONTRAST_LABEL);
  const baselineBrightness = await settledAverageRenderedBrightness();
  await setBrightnessContrastSlider(launched.window, BRIGHTNESS_SLIDER_LABEL, BRIGHTNESS_PERCENT);
  await expectRenderedBrightnessIncreasedAbove(baselineBrightness);
  await cancelOperation(launched.window, BRIGHTNESS_CONTRAST_LABEL);
  await expectRenderedBrightnessRestoredTo(baselineBrightness);
  await expectTopLeftReadout(TOP_LEFT_RAW_VALUE);
});

async function settledAverageRenderedBrightness(): Promise<number> {
  await launched.window.waitForTimeout(200);
  return averageRenderedBrightness();
}

async function averageRenderedBrightness(): Promise<number> {
  const average = await averageNonClearCanvasColor(panelCanvas(launched.window, PANEL));
  return average.red;
}

async function expectRenderedBrightnessIncreasedAbove(baselineBrightness: number): Promise<void> {
  await expect.poll(() => averageRenderedBrightness()).toBeGreaterThan(baselineBrightness + MIN_BRIGHTENING_DELTA);
}

async function expectRenderedBrightnessRestoredTo(baselineBrightness: number): Promise<void> {
  await expect.poll(() => averageRenderedBrightness()).toBeLessThan(baselineBrightness + MIN_BRIGHTENING_DELTA / 2);
}

async function expectTopLeftReadout(expected: number): Promise<void> {
  await expectPixelReadoutToEqual(launched.window, {
    panel: PANEL,
    imageX: 0,
    imageY: 0,
    dimensions: DIMENSIONS,
    expected,
  });
}
