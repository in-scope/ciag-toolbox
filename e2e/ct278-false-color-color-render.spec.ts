import { expect, test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperationInPlace,
  loadFixtureAsStack,
  openOperation,
  panelCanvas,
  panelCell,
  selectPanel,
  type PixelDimensions,
} from "./support/page-objects";
import { summarizeCanvasHues, summarizeCanvasPixels } from "./support/canvas-pixels";
import { expectChannelViewEnabled } from "./support/channel-view";
import { readPixelValueAt } from "./support/pixel-readout";

// CT-278: the committed false-color composite is tagged as a true-colour rgb
// raster, so it renders as ONE colour image: the canvas mixes the three
// assigned bands into per-pixel hues instead of showing band 1 as grayscale,
// the band navigator disappears, and the CT-248 channel-view toggle is offered
// for per-band inspection.
//
// FIXTURE: multiband-12bit.tif (4x4 uint16, three ramp bands 100-250 / 800-950
// / 1600-1750). The bands hold 12-bit values, so the raw composite renders DARK
// over the uint16 display unit (R about 0-1, G 3-4, B 6-7 in display bytes) -
// dark, but genuinely hued: every image pixel's blue channel sits well above
// its red channel. ORACLES: summarizeCanvasHues (all-pixel channel-spread
// population plus distinct hue colours; a grayscale render scores zero on
// both), the distinct-colour count from summarizeCanvasPixels, the band
// navigator locator, and the pixel-readout oracle proving the data kept its
// true 12-bit values.

const PANEL = 1;
const DIMENSIONS: PixelDimensions = {
  width: multiBandTiff.width,
  height: multiBandTiff.height,
};
// CT-292: user-facing "False-color Composite" is renamed "RGB Color Composite".
const FALSE_COLOR_LABEL = "RGB Color Composite";
// Every image pixel's display-byte channel spread is at least 5 (blue 6-7
// against red 0-1); the floor of 3 leaves headroom for GPU rounding.
const HUE_CHANNEL_SPREAD_FLOOR = 3;
const MIN_HUED_PIXEL_FRACTION = 0.1;
const MIN_DISTINCT_HUES = 2;
const MIN_DISTINCT_COLORS = 3;
const PROBE = { x: 0, y: 0 };
const PROBE_RED_CHANNEL_VALUE = String(multiBandTiff.samplePixels[0]!.valuesPerBand[0]!);

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("the committed false-color composite renders in colour without a band navigator", async () => {
  await test.step("open multiband-12bit.tif as a scientific stack with its band navigator", async () => {
    await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
    await selectPanel(launched.window, PANEL);
    await expect(bandNavigator()).toBeVisible();
  });

  await test.step("apply the composite with the default band assignment", async () => {
    await openOperation(launched.window, FALSE_COLOR_LABEL);
    await applyOperationInPlace(launched.window, FALSE_COLOR_LABEL);
  });

  await test.step("the canvas shows more than one distinct hue", async () => {
    await expect
      .poll(async () => {
        const hues = await summarizeCanvasHues(panelCanvas(launched.window, PANEL), HUE_CHANNEL_SPREAD_FLOOR);
        return hues.distinctHueCount;
      })
      .toBeGreaterThanOrEqual(MIN_DISTINCT_HUES);
    const hues = await summarizeCanvasHues(panelCanvas(launched.window, PANEL), HUE_CHANNEL_SPREAD_FLOOR);
    expect(hues.huedPixelCount / hues.sampledPixelCount).toBeGreaterThan(MIN_HUED_PIXEL_FRACTION);
    const pixels = await summarizeCanvasPixels(panelCanvas(launched.window, PANEL));
    expect(pixels.distinctColorCount).toBeGreaterThan(MIN_DISTINCT_COLORS);
  });

  await test.step("the band navigator is gone and the channel-view toggle is offered", async () => {
    await expect(bandNavigator()).toHaveCount(0);
    await expectChannelViewEnabled(launched.window, PANEL, false);
  });

  await test.step("the composite keeps the true 12-bit band values", async () => {
    await expect
      .poll(async () => {
        const readout = await readPixelValueAt(launched.window, PANEL, PROBE.x, PROBE.y, DIMENSIONS);
        return readout.value;
      })
      .toBe(PROBE_RED_CHANNEL_VALUE);
  });
});

function bandNavigator() {
  return panelCell(launched.window, PANEL).getByTestId("viewport-band-navigator");
}
