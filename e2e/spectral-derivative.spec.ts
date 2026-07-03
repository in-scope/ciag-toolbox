import { expect, test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperation,
  countPanels,
  expectHistoryToRecordOperation,
  expectMetadataDataTypeAndDimensions,
  expectPixelReadoutToEqual,
  loadFixtureAsStack,
  openOperation,
  readMetadata,
  selectPanel,
  setOperationEnumParameter,
  type PixelDimensions,
} from "./support/page-objects";

// CT-202: the spectral derivative differences the cube along the wavelength
// axis into a NEW float32 stack (N - order bands) opened in a fresh panel.
// The committed 3-band uint16 multiband-12bit.tif is the oracle: its bands are
// collinear (band 2 = band 1 + 700, band 3 = band 2 + 800 at EVERY pixel), so
// the first-order derivative reads exactly 700 in its first band and the
// second-order derivative reads exactly 800 - 700 = 100, at any sampled pixel.

const SPECTRAL_DERIVATIVE = "Spectral Derivative";
const RESULT_PANEL = 2;
const FLOAT32 = "float32";
const DIMENSIONS: PixelDimensions = { width: multiBandTiff.width, height: multiBandTiff.height };
const FIRST_ORDER_BAND_COUNT = multiBandTiff.bandCount - 1;
const SECOND_ORDER_BAND_COUNT = multiBandTiff.bandCount - 2;
const FIRST_ORDER_BAND_ONE_VALUE = 700;
const SECOND_ORDER_VALUE = 100;
const FLOAT_READOUT_TOLERANCE = 0.001;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("first order (the default) opens a new float32 stack of adjacent band differences", async () => {
  await openOperation(launched.window, SPECTRAL_DERIVATIVE);
  await applyOperation(launched.window, SPECTRAL_DERIVATIVE);

  expect(await countPanels(launched.window)).toBe(RESULT_PANEL);
  await selectPanel(launched.window, RESULT_PANEL);
  await expectResultIsFloat32StackWithBandCount(FIRST_ORDER_BAND_COUNT);
  await expectPixelReadoutToEqual(launched.window, {
    panel: RESULT_PANEL,
    imageX: 0,
    imageY: 0,
    dimensions: DIMENSIONS,
    expected: FIRST_ORDER_BAND_ONE_VALUE,
    tolerance: FLOAT_READOUT_TOLERANCE,
  });
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: SPECTRAL_DERIVATIVE,
    detailSubstrings: ["Spectral derivative (1st order)"],
  });
});

test("second order differences the differences and records the order in History", async () => {
  await openOperation(launched.window, SPECTRAL_DERIVATIVE);
  await setOperationEnumParameter(launched.window, SPECTRAL_DERIVATIVE, "2");
  await applyOperation(launched.window, SPECTRAL_DERIVATIVE);

  expect(await countPanels(launched.window)).toBe(RESULT_PANEL);
  await selectPanel(launched.window, RESULT_PANEL);
  await expectResultIsFloat32StackWithBandCount(SECOND_ORDER_BAND_COUNT);
  await expectPixelReadoutToEqual(launched.window, {
    panel: RESULT_PANEL,
    imageX: 0,
    imageY: 0,
    dimensions: DIMENSIONS,
    expected: SECOND_ORDER_VALUE,
    tolerance: FLOAT_READOUT_TOLERANCE,
  });
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: SPECTRAL_DERIVATIVE,
    detailSubstrings: ["Spectral derivative (2nd order)"],
  });
});

async function expectResultIsFloat32StackWithBandCount(expectedBandCount: number): Promise<void> {
  await expectMetadataDataTypeAndDimensions(launched.window, {
    dataType: FLOAT32,
    width: multiBandTiff.width,
    height: multiBandTiff.height,
  });
  const metadata = await readMetadata(launched.window);
  expect(metadata.bandCount).toBe(String(expectedBandCount));
}
