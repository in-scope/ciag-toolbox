import { test } from "@playwright/test";

import { enviStack, fixturePath, multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperationInPlace,
  expectMetadataDataTypeAndDimensions,
  expectPixelReadoutToEqual,
  loadFixtureAsStack,
  openOperation,
  reimportPanelSourceFromDisk,
  selectActiveBandNumber,
  selectPanel,
  type PixelDimensions,
} from "./support/page-objects";

// CT-234: "Re-import source from disk" obtains its file bytes through the
// chunked opened-image read protocol (the dialog reply is metadata only), the
// same path the main open flow uses. The observable outcomes: a modified stack
// is restored to the on-disk values, and an ENVI header re-imports by streaming
// its binary sibling (the flow that previously arrived as one assembled
// sidecar reply). All assertions read the TRUE status-bar readout.

const PANEL = 1;
const BIT_SHIFT = "Bit Shift";
const SHIFT_MULTIPLIER = 2 ** 4;
const DIMENSIONS: PixelDimensions = { width: multiBandTiff.width, height: multiBandTiff.height };

const MULTIBAND_ORIGIN_BAND1 = requireOriginValue(multiBandTiff.samplePixels[0]?.valuesPerBand[0]);
const ENVI_ORIGIN_BAND1 = requireOriginValue(enviStack.samplePixels[0]?.valuesPerBand[0]);
const ENVI_ORIGIN_BAND3 = requireOriginValue(enviStack.samplePixels[0]?.valuesPerBand[2]);

function requireOriginValue(value: number | undefined): number {
  if (value === undefined) throw new Error("fixture manifest is missing an origin sample value");
  return value;
}

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, PANEL);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("re-importing the original file restores a modified stack's true values", async () => {
  await openOperation(launched.window, BIT_SHIFT);
  await applyOperationInPlace(launched.window, BIT_SHIFT);
  await expectOriginReadoutEquals(MULTIBAND_ORIGIN_BAND1 * SHIFT_MULTIPLIER);

  await reimportPanelSourceFromDisk(launched.window, PANEL, fixturePath(multiBandTiff.fileName));

  await expectOriginReadoutEquals(MULTIBAND_ORIGIN_BAND1);
  await selectPanel(launched.window, PANEL);
  await expectMetadataDataTypeAndDimensions(launched.window, {
    dataType: multiBandTiff.dataType,
    width: multiBandTiff.width,
    height: multiBandTiff.height,
  });
});

test("re-importing an ENVI header streams the binary sibling into the panel", async () => {
  await reimportPanelSourceFromDisk(launched.window, PANEL, fixturePath(enviStack.headerFileName));

  await expectOriginReadoutEquals(ENVI_ORIGIN_BAND1);
  await selectActiveBandNumber(launched.window, enviStack.bandCount);
  await expectOriginReadoutEquals(ENVI_ORIGIN_BAND3);
  await selectPanel(launched.window, PANEL);
  await expectMetadataDataTypeAndDimensions(launched.window, {
    dataType: enviStack.dataType,
    width: enviStack.width,
    height: enviStack.height,
  });
});

async function expectOriginReadoutEquals(expected: number): Promise<void> {
  await expectPixelReadoutToEqual(launched.window, {
    panel: PANEL,
    imageX: 0,
    imageY: 0,
    dimensions: DIMENSIONS,
    expected,
  });
}
