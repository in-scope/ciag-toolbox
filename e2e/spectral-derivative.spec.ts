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
  selectActiveBandNumberInPanel,
  selectPanel,
  setOperationEnumParameter,
  type PixelDimensions,
} from "./support/page-objects";

// CT-202 / CT-285: the spectral derivative differences the cube along the
// wavelength axis into a NEW float32 stack that KEEPS the source band count
// (one-sided differences fill the edge bands). The committed 3-band uint16
// multiband-12bit.tif is the oracle: its bands are collinear (band 2 = band 1
// + 700, band 3 = band 2 + 800 at EVERY pixel), so the first-order derivative
// reads exactly [700, 800, 800] per band (the last band takes the one-sided
// backward difference) and the second-order derivative reads exactly
// 800 - 700 = 100 in every band, at any sampled pixel.

const SPECTRAL_DERIVATIVE = "Spectral Derivative";
const RESULT_PANEL = 2;
const FLOAT32 = "float32";
const DIMENSIONS: PixelDimensions = { width: multiBandTiff.width, height: multiBandTiff.height };
const FIRST_ORDER_VALUES_PER_BAND = [700, 800, 800];
const SECOND_ORDER_VALUE = 100;
const INTERIOR_BAND_NUMBER = 2;
const EDGE_BAND_NUMBER = multiBandTiff.bandCount;
const FLOAT_READOUT_TOLERANCE = 0.001;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("first order (the default) keeps the band count with a one-sided last band", async () => {
  await openOperation(launched.window, SPECTRAL_DERIVATIVE);
  await applyOperation(launched.window, SPECTRAL_DERIVATIVE);

  expect(await countPanels(launched.window)).toBe(RESULT_PANEL);
  await selectPanel(launched.window, RESULT_PANEL);
  await expectResultIsFloat32StackKeepingSourceBandCount();
  for (const [bandIndex, expected] of FIRST_ORDER_VALUES_PER_BAND.entries()) {
    await expectDerivativeReadoutOnBand(bandIndex + 1, expected);
  }
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: SPECTRAL_DERIVATIVE,
    detailSubstrings: ["Spectral derivative (1st order)"],
  });
});

test("second order keeps the band count with one-sided edges and records the order in History", async () => {
  await openOperation(launched.window, SPECTRAL_DERIVATIVE);
  await setOperationEnumParameter(launched.window, SPECTRAL_DERIVATIVE, "2");
  await applyOperation(launched.window, SPECTRAL_DERIVATIVE);

  expect(await countPanels(launched.window)).toBe(RESULT_PANEL);
  await selectPanel(launched.window, RESULT_PANEL);
  await expectResultIsFloat32StackKeepingSourceBandCount();
  await expectDerivativeReadoutOnBand(INTERIOR_BAND_NUMBER, SECOND_ORDER_VALUE);
  await expectDerivativeReadoutOnBand(EDGE_BAND_NUMBER, SECOND_ORDER_VALUE);
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: SPECTRAL_DERIVATIVE,
    detailSubstrings: ["Spectral derivative (2nd order)"],
  });
});

async function expectResultIsFloat32StackKeepingSourceBandCount(): Promise<void> {
  await expectMetadataDataTypeAndDimensions(launched.window, {
    dataType: FLOAT32,
    width: multiBandTiff.width,
    height: multiBandTiff.height,
  });
  const metadata = await readMetadata(launched.window);
  expect(metadata.bandCount).toBe(String(multiBandTiff.bandCount));
}

async function expectDerivativeReadoutOnBand(
  oneBasedBandNumber: number,
  expected: number,
): Promise<void> {
  await selectActiveBandNumberInPanel(launched.window, RESULT_PANEL, oneBasedBandNumber);
  await expectPixelReadoutToEqual(launched.window, {
    panel: RESULT_PANEL,
    imageX: 0,
    imageY: 0,
    dimensions: DIMENSIONS,
    expected,
    tolerance: FLOAT_READOUT_TOLERANCE,
  });
}
