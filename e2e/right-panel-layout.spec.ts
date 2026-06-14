import { test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  activateRegionTool,
  applicationToolbar,
  applyOperationInPlace,
  drawInspectionRoiBetweenPixels,
  expectLiveHoverSpectrumVisible,
  expectNoLiveHoverSpectrum,
  expectNoRemovedRightPanelSections,
  expectPinnedSpectrumLineCount,
  expectRightPanelSectionsInFixedOrder,
  hoverImagePixel,
  loadFixtureAsStack,
  openOperation,
  pinPixelSpectrum,
  type ImagePixel,
} from "./support/page-objects";

// CT-151 / manual section 18 (CT-092): decluttered right panel order and live hover spectrum.
//
//   AC1 - the right-panel sections appear in the fixed order Metadata, Histogram, Spectra,
//   Region, History, with no Bands list and no Pixel Inspector section. Histogram + Spectra
//   need a multi-band raster; Region needs a committed ROI; History needs one applied
//   operation, so the setup loads the 3-band fixture, applies one in-place Bit Shift, then
//   draws an inspection ROI to bring every section on screen at once.
//   AC2 - hovering the image draws a LIVE distinct (dashed) pixel spectrum that disappears on
//   pointer-leave; clicking PINS it (solid, persists after the pointer leaves).

const PANEL = 1;
const DIMENSIONS = { width: multiBandTiff.width, height: multiBandTiff.height };
const BIT_SHIFT = "Bit Shift";
const HOVER_PIXEL = { x: 1, y: 1 };
const ROI_TOP_LEFT: ImagePixel = { x: 1, y: 1 };
const ROI_BOTTOM_RIGHT: ImagePixel = { x: 2, y: 2 };

test.describe("CT-151: decluttered right panel order", () => {
  let launched: LaunchedApp;

  test.beforeAll(async () => {
    launched = await launchToolboxApp();
    await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
    await bringEveryRightPanelSectionOnScreen(launched);
  });

  test.afterAll(async () => {
    await closeToolboxApp(launched);
  });

  test("renders the five sections in the fixed Metadata-Histogram-Spectra-Region-History order", async () => {
    await expectRightPanelSectionsInFixedOrder(launched.window);
  });

  test("shows no Bands list and no Pixel Inspector section", async () => {
    await expectNoRemovedRightPanelSections(launched.window);
  });
});

test.describe("CT-151: live hover spectrum", () => {
  let launched: LaunchedApp;

  // Loading auto-selects the panel; a center-of-canvas selectPanel click is avoided because on
  // a multi-band raster it would pin the centre pixel's spectrum before the test runs.
  test.beforeAll(async () => {
    launched = await launchToolboxApp();
    await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  });

  test.afterAll(async () => {
    await closeToolboxApp(launched);
  });

  test("draws a live spectrum on hover that disappears when the pointer leaves the image", async () => {
    await hoverImagePixel(launched.window, PANEL, HOVER_PIXEL.x, HOVER_PIXEL.y, DIMENSIONS);
    await expectLiveHoverSpectrumVisible(launched.window);
    await expectPinnedSpectrumLineCount(launched.window, 0);

    await applicationToolbar(launched.window).hover();
    await expectNoLiveHoverSpectrum(launched.window);
  });

  test("pins the hovered spectrum on click so it persists after the pointer leaves", async () => {
    await pinPixelSpectrum(launched.window, PANEL, HOVER_PIXEL.x, HOVER_PIXEL.y, DIMENSIONS);
    await expectPinnedSpectrumLineCount(launched.window, 1);
    await expectNoLiveHoverSpectrum(launched.window);
  });
});

async function bringEveryRightPanelSectionOnScreen(launched: LaunchedApp): Promise<void> {
  await openOperation(launched.window, BIT_SHIFT);
  await applyOperationInPlace(launched.window, BIT_SHIFT);
  await activateRegionTool(launched.window);
  await drawInspectionRoiBetweenPixels(launched.window, PANEL, ROI_TOP_LEFT, ROI_BOTTOM_RIGHT, DIMENSIONS);
}
