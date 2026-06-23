import { expect, test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperationInPlace,
  ensureRegionToolInactive,
  loadFixtureAsStack,
  openOperation,
  pinPixelSpectrum,
  pinnedPixelSpectrumLegendRows,
  selectOperationRegionByDrag,
} from "./support/page-objects";

// CT-188: a crop changes the image's coordinate space, so any pinned pixel spectrum is now at
// stale coordinates. Applying a crop must clear the pinned-spectrum lists so no stale pins
// linger on the Spectra panel. Oracle: pin one pixel spectrum (a "Pixel (x, y)" legend row),
// crop to a sub-rectangle, then assert no pinned-spectrum legend rows remain.
// Fixture: multiband-12bit.tif (4x4 3-band uint16, per the manifest).

const PANEL = 1;
const CROP = "Crop to Region";
const SOURCE_DIMENSIONS = { width: multiBandTiff.width, height: multiBandTiff.height };

const PINNED_PIXEL = { x: 1, y: 1 };
const CROP_REGION_TOP_LEFT = { x: 2, y: 2 };
const CROP_REGION_BOTTOM_RIGHT = { x: 3, y: 3 };

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("cropping clears pinned spectra so no stale pins remain", async () => {
  await pinOnePixelSpectrum();
  await expect(pinnedPixelSpectrumLegendRows(launched.window)).toHaveCount(1);
  await cropToBottomRightSubRectangle();
  await expect(pinnedPixelSpectrumLegendRows(launched.window)).toHaveCount(0);
});

async function pinOnePixelSpectrum(): Promise<void> {
  await ensureRegionToolInactive(launched.window);
  await pinPixelSpectrum(launched.window, PANEL, PINNED_PIXEL.x, PINNED_PIXEL.y, SOURCE_DIMENSIONS);
}

async function cropToBottomRightSubRectangle(): Promise<void> {
  await openOperation(launched.window, CROP);
  await selectOperationRegionByDrag(launched.window, {
    panelNumber: PANEL,
    operationLabel: CROP,
    startPixel: CROP_REGION_TOP_LEFT,
    endPixel: CROP_REGION_BOTTOM_RIGHT,
    imageDimensions: SOURCE_DIMENSIONS,
  });
  await applyOperationInPlace(launched.window, CROP);
}
