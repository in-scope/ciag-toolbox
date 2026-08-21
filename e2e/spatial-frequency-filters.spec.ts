import { expect, test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperation,
  countPanels,
  expectHistoryToRecordOperation,
  expectMetadataDataTypeAndDimensions,
  loadFixtureAsStack,
  openOperation,
  readMetadata,
  readPixelValueAt,
  selectPanel,
  setOperationEnumParameter,
  type PixelDimensions,
} from "./support/page-objects";

// CT-203: the spatial frequency filter (Butterworth high/low/bandpass) reshapes
// each band's picture into a NEW float32 stack opened in a fresh panel.
// multiband-12bit.tif band 1 is a spatial ramp (100 at (0,0), mean 175), so any
// mode changes the value at (0,0): high-pass and bandpass remove the DC mean
// (the readout falls far below 100), low-pass pulls the pixel toward the mean.
// The pixel-readout oracle asserts the output DIFFERS from the source value.

const FREQUENCY_FILTERS = "Frequency Filters";
const RESULT_PANEL = 2;
const FLOAT32 = "float32";
const DIMENSIONS: PixelDimensions = { width: multiBandTiff.width, height: multiBandTiff.height };
const SOURCE_BAND_ONE_VALUE_AT_ORIGIN = 100;
const MINIMUM_FILTERED_DIFFERENCE = 20;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("low-pass (the default) opens a new float32 stack whose values moved toward the mean", async () => {
  await openOperation(launched.window, FREQUENCY_FILTERS);
  await applyOperation(launched.window, FREQUENCY_FILTERS);

  await expectResultIsFullSizeFloat32Stack();
  await expectOriginPixelDiffersFromSource();
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: FREQUENCY_FILTERS,
    detailSubstrings: ["Frequency filters (low-pass, cutoff 0.15, full stack)"],
  });
});

test("high-pass removes the flat background so the readout falls away from the source value", async () => {
  await openOperation(launched.window, FREQUENCY_FILTERS);
  await setOperationEnumParameter(launched.window, FREQUENCY_FILTERS, "highpass");
  await applyOperation(launched.window, FREQUENCY_FILTERS);

  await expectResultIsFullSizeFloat32Stack();
  await expectOriginPixelDiffersFromSource();
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: FREQUENCY_FILTERS,
    detailSubstrings: ["Frequency filters (high-pass, cutoff 0.05, full stack)"],
  });
});

test("bandpass keeps only mid frequencies and records both cutoffs in History", async () => {
  await openOperation(launched.window, FREQUENCY_FILTERS);
  await setOperationEnumParameter(launched.window, FREQUENCY_FILTERS, "bandpass");
  await applyOperation(launched.window, FREQUENCY_FILTERS);

  await expectResultIsFullSizeFloat32Stack();
  await expectOriginPixelDiffersFromSource();
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: FREQUENCY_FILTERS,
    detailSubstrings: ["Frequency filters (bandpass 0.05 - 0.25, full stack)"],
  });
});

async function expectResultIsFullSizeFloat32Stack(): Promise<void> {
  expect(await countPanels(launched.window)).toBe(RESULT_PANEL);
  await selectPanel(launched.window, RESULT_PANEL);
  await expectMetadataDataTypeAndDimensions(launched.window, {
    dataType: FLOAT32,
    width: multiBandTiff.width,
    height: multiBandTiff.height,
  });
  const metadata = await readMetadata(launched.window);
  expect(metadata.bandCount).toBe(String(multiBandTiff.bandCount));
}

async function expectOriginPixelDiffersFromSource(): Promise<void> {
  const readout = await readPixelValueAt(launched.window, RESULT_PANEL, 0, 0, DIMENSIONS);
  const filteredValue = Number.parseFloat(readout.value);
  expect(Number.isFinite(filteredValue)).toBe(true);
  expect(Math.abs(filteredValue - SOURCE_BAND_ONE_VALUE_AT_ORIGIN)).toBeGreaterThan(
    MINIMUM_FILTERED_DIFFERENCE,
  );
}
