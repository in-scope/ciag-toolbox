import { test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  cancelOperation,
  expectExactlyOneCommittedRoi,
  expectNoCommittedRoiMarkers,
  loadFixtureAsStack,
  openOperation,
  selectGridLayout,
  selectOperationRegionByDrag,
  selectPanel,
  selectRegionOfInterestScope,
} from "./support/page-objects";

// CT-261: the operation region box never strands. A region selected for an
// operation (PCA's ROI fit, Crop to Region) must disappear from a panel the
// moment the selection moves to another panel, and the open-Crop -> select
// region -> switch panel -> Cancel sequence must leave no box on EITHER image.
// Fixture: multiband-12bit.tif in two panels; oracle: the committed region
// overlay markers (dashed border rect + corner handles) absent from the DOM.

const PCA = "PCA";
const CROP = "Crop to Region";
const FIRST_PANEL = 1;
const SECOND_PANEL = 2;
const SOURCE_DIMENSIONS = { width: multiBandTiff.width, height: multiBandTiff.height };
const REGION_TOP_LEFT = { x: 1, y: 1 };
const REGION_BOTTOM_RIGHT = { x: 3, y: 3 };

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await selectGridLayout(launched.window, "1x2");
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("a PCA fit region disappears from the first panel when another panel is selected", async () => {
  await selectPanel(launched.window, FIRST_PANEL);
  await openOperation(launched.window, PCA);
  await selectRegionOfInterestScope(launched.window, PCA);
  await selectRegionOnFirstPanelFor(PCA);
  await expectExactlyOneCommittedRoi(launched.window, FIRST_PANEL);

  await selectPanel(launched.window, SECOND_PANEL);

  await expectNoCommittedRoiMarkers(launched.window, FIRST_PANEL);
  await expectNoCommittedRoiMarkers(launched.window, SECOND_PANEL);
});

test("open Crop, select a region, switch panels, Cancel: no box remains on either image", async () => {
  await selectPanel(launched.window, FIRST_PANEL);
  await openOperation(launched.window, CROP);
  await selectRegionOnFirstPanelFor(CROP);
  await expectExactlyOneCommittedRoi(launched.window, FIRST_PANEL);

  await selectPanel(launched.window, SECOND_PANEL);
  await cancelOperation(launched.window, CROP);

  await expectNoCommittedRoiMarkers(launched.window, FIRST_PANEL);
  await expectNoCommittedRoiMarkers(launched.window, SECOND_PANEL);
});

async function selectRegionOnFirstPanelFor(operationLabel: string): Promise<void> {
  await selectOperationRegionByDrag(launched.window, {
    panelNumber: FIRST_PANEL,
    operationLabel,
    startPixel: REGION_TOP_LEFT,
    endPixel: REGION_BOTTOM_RIGHT,
    imageDimensions: SOURCE_DIMENSIONS,
  });
}
