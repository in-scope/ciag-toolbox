import { expect, test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperation,
  expectHistoryToRecordOperation,
  expectPixelReadoutToEqual,
  expectThresholdEditorReady,
  loadFixtureAsStack,
  openOperation,
  readMetadata,
  selectFullStackScope,
  selectPanel,
  setThresholdBoundField,
  THRESHOLD_OPERATION_LABEL,
} from "./support/page-objects";
import type { PixelDimensions } from "./support/page-objects";
import { selectActiveBandNumberInPanel } from "./scale10.support";

// CT-282: a manual full-stack threshold no longer ANDs bands into one band -
// the entered bounds apply uniformly to EVERY band and the output is a binary
// stack with the SOURCE band count. multiband-12bit.tif is a 4x4x3 uint16
// stack whose bands are ramps of step 10: 100..250, 800..950, 1600..1750.
// With bounds [800, 1700]: band 1 goes all black, band 2 all white, and band 3
// splits at 1700 (pixel (2,2) holds exactly 1700 = white, (3,2) holds 1710 =
// black). Oracle: the Metadata Bands row plus the pixel-readout oracle per band.

const SOURCE_PANEL = 1;
const RESULT_PANEL = 2;
const FIXTURE = multiBandTiff;
const DIMENSIONS: PixelDimensions = { width: FIXTURE.width, height: FIXTURE.height };
const LOWER_BOUND = 800;
const UPPER_BOUND = 1700;
const WHITE = 255;
const BLACK = 0;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, FIXTURE.fileName);
  await selectPanel(launched.window, SOURCE_PANEL);
  await openOperation(launched.window, THRESHOLD_OPERATION_LABEL);
  await expectThresholdEditorReady(launched.window);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("a manual full-stack threshold keeps the source band count", async () => {
  await setThresholdBoundField(launched.window, "Lower", LOWER_BOUND);
  await setThresholdBoundField(launched.window, "Upper", UPPER_BOUND);
  await selectFullStackScope(launched.window, THRESHOLD_OPERATION_LABEL);
  await applyOperation(launched.window, THRESHOLD_OPERATION_LABEL);
  await selectPanel(launched.window, RESULT_PANEL);
  expect((await readMetadata(launched.window)).bandCount).toBe(String(FIXTURE.bandCount));
  await expectEveryBandThresholdedByTheSharedBounds();
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: THRESHOLD_OPERATION_LABEL,
    detailSubstrings: [`[${LOWER_BOUND}, ${UPPER_BOUND}]`, "full stack"],
  });
});

async function expectEveryBandThresholdedByTheSharedBounds(): Promise<void> {
  await expectResultReadoutOnBand(1, 0, 0, BLACK);
  await expectResultReadoutOnBand(1, 3, 3, BLACK);
  await expectResultReadoutOnBand(2, 0, 0, WHITE);
  await expectResultReadoutOnBand(2, 3, 3, WHITE);
  await expectResultReadoutOnBand(3, 2, 2, WHITE);
  await expectResultReadoutOnBand(3, 3, 2, BLACK);
}

async function expectResultReadoutOnBand(
  bandNumber: number,
  imageX: number,
  imageY: number,
  expected: number,
): Promise<void> {
  await selectActiveBandNumberInPanel(launched.window, RESULT_PANEL, bandNumber);
  await expectPixelReadoutToEqual(launched.window, {
    panel: RESULT_PANEL,
    imageX,
    imageY,
    dimensions: DIMENSIONS,
    expected,
  });
}
