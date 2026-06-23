import { test, expect } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperationInPlace,
  expectHistoryToRecordOperation,
  historyEntryCount,
  loadFixtureAsStack,
  openOperation,
  selectOperationRegionByDrag,
  selectPanel,
} from "./support/page-objects";

// CT-191: an applied crop must record its region's four pixel coordinates in History as
// "Crop to (x0, y0) - (x1, y1)" (formatCropToRegionAppliedLabel). The production code already
// does this; this spec regression-locks it end-to-end. Cropping source pixels (2,2)-(3,3) of
// the 4x4 multiband-12bit.tif yields the canonical label "Crop to (2, 2) - (3, 3)".

const PANEL = 1;
const CROP = "Crop to Region";
const SOURCE_DIMENSIONS = { width: multiBandTiff.width, height: multiBandTiff.height };

const CROP_REGION_TOP_LEFT = { x: 2, y: 2 };
const CROP_REGION_BOTTOM_RIGHT = { x: 3, y: 3 };
const EXPECTED_CROP_LABEL = "Crop to (2, 2) - (3, 3)";

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, PANEL);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("History records the crop region's four pixel coordinates", async () => {
  await openOperation(launched.window, CROP);
  await selectCropRegion();
  await applyOperationInPlace(launched.window, CROP);
  await expect.poll(() => historyEntryCount(launched.window)).toBe(1);
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: CROP,
    detailSubstrings: [EXPECTED_CROP_LABEL],
  });
});

async function selectCropRegion(): Promise<void> {
  await selectOperationRegionByDrag(launched.window, {
    panelNumber: PANEL,
    operationLabel: CROP,
    startPixel: CROP_REGION_TOP_LEFT,
    endPixel: CROP_REGION_BOTTOM_RIGHT,
    imageDimensions: SOURCE_DIMENSIONS,
  });
}
