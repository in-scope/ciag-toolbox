import { expect, test } from "@playwright/test";

import { multiBandTiff, rgbPng } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  addToneCurveAnchorAtFraction,
  colorfulNonClearPixelFraction,
  expectToneCurveChannelIsActive,
  expectToneCurveChannelSelectorAbsent,
  expectToneCurveChannelSelectorPresent,
  expectToneCurveHistogramBackdrop,
  expectToneCurveOpensWithTwoEndpoints,
  loadFixtureAsStack,
  openOperation,
  panelCanvas,
  readToneCurveEditingBandLabel,
  selectActiveBandNumber,
  selectPanel,
  selectToneCurveChannel,
  toneCurveChannelButton,
  toneCurveEndpointHandles,
  toneCurveInteriorHandles,
  TONE_CURVE_LABEL,
  type ToneCurveChannelButtonName,
} from "./support/page-objects";

// CT-176: the tone-curve panel adapts to what the loaded stack is. A true-colour composite
// (rgb.png, promoted to a 3-band rgb raster at load) gets an RGB/R/G/B channel selector, each
// option targeting that channel's own curve over that channel's histogram backdrop while the
// viewport stays the full-colour composite. A scientific multi-band stack (multiband-12bit.tif)
// instead shows a read-only "Editing band N" label that follows the band navigator and no
// selector. Per-channel curve persistence is the real behavioural oracle; the histogram backdrop
// is observed through the channel-named canvas; the composite-stays-colour claim is observed by
// canvas-pixel sampling so it cannot pass vacuously.

const PANEL = 1;
const ALL_CHANNEL_BUTTONS: ReadonlyArray<ToneCurveChannelButtonName> = ["RGB", "Red", "Green", "Blue"];
const MIN_COMPOSITE_COLOUR_FRACTION = 0.2;

let launched: LaunchedApp;

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test.describe("true-colour composite (rgb.png)", () => {
  test.beforeEach(async () => {
    launched = await launchToolboxApp();
    await loadFixtureAsStack(launched.window, rgbPng.fileName);
    await selectPanel(launched.window, PANEL);
    await openOperation(launched.window, TONE_CURVE_LABEL);
  });

  test("shows the RGB/R/G/B selector and defaults to the combined Value backdrop", async () => {
    await expectToneCurveChannelSelectorPresent(launched.window);
    for (const name of ALL_CHANNEL_BUTTONS) {
      await expect(toneCurveChannelButton(launched.window, name)).toBeVisible();
    }
    await expectToneCurveChannelIsActive(launched.window, "RGB");
    await expectToneCurveHistogramBackdrop(launched.window, "Value");
  });

  test("switching channel switches the histogram backdrop while the viewport stays full colour", async () => {
    await expectCompositeViewportIsColourful();
    await selectToneCurveChannel(launched.window, "Red");
    await expectToneCurveChannelIsActive(launched.window, "Red");
    await expectToneCurveHistogramBackdrop(launched.window, "Red");
    await selectToneCurveChannel(launched.window, "Blue");
    await expectToneCurveChannelIsActive(launched.window, "Blue");
    await expectToneCurveHistogramBackdrop(launched.window, "Blue");
    await expectCompositeViewportIsColourful();
  });

  test("each channel keeps its own curve as the selection moves between channels", async () => {
    await selectToneCurveChannel(launched.window, "Red");
    await expectToneCurveOpensWithTwoEndpoints(launched.window);
    await addToneCurveAnchorAtFraction(launched.window, 0.5, 0.5);
    await expect(toneCurveInteriorHandles(launched.window)).toHaveCount(1);
    await selectToneCurveChannel(launched.window, "Green");
    await expectToneCurveOpensWithTwoEndpoints(launched.window);
    await selectToneCurveChannel(launched.window, "Red");
    await expect(toneCurveInteriorHandles(launched.window)).toHaveCount(1);
    await expect(toneCurveEndpointHandles(launched.window)).toHaveCount(2);
  });
});

test.describe("scientific multi-band stack (multiband-12bit.tif)", () => {
  test.beforeEach(async () => {
    launched = await launchToolboxApp();
    await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
    await selectPanel(launched.window, PANEL);
    await openOperation(launched.window, TONE_CURVE_LABEL);
  });

  test("has no selector and shows a read-only Editing band label that tracks the navigator", async () => {
    await expectToneCurveChannelSelectorAbsent(launched.window);
    expect(await readToneCurveEditingBandLabel(launched.window)).toBe("Editing band 1");
    await selectActiveBandNumber(launched.window, 2);
    await expect.poll(() => readToneCurveEditingBandLabel(launched.window)).toBe("Editing band 2");
    await selectActiveBandNumber(launched.window, 3);
    await expect.poll(() => readToneCurveEditingBandLabel(launched.window)).toBe("Editing band 3");
  });
});

async function expectCompositeViewportIsColourful(): Promise<void> {
  const colourFraction = await colorfulNonClearPixelFraction(panelCanvas(launched.window, PANEL));
  expect(colourFraction).toBeGreaterThan(MIN_COMPOSITE_COLOUR_FRACTION);
}
