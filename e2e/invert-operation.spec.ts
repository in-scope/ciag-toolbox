import { expect, test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperation,
  applyOperationInPlace,
  clickGridBackgroundToClearSelection,
  expectHistoryToRecordOperation,
  expectMetadataDataTypeAndDimensions,
  expectPanelHoldsFile,
  expectPanelIsEmpty,
  expectPixelReadoutToEqual,
  loadFixtureAsStack,
  loadImageFromAbsolutePath,
  openOperation,
  readPixelValueAt,
  selectFullStackScope,
  selectGridLayout,
  selectPanel,
  setOperationNumberParameter,
  UINT8_FIXTURE_SIDE,
  uint8FixtureValueAt,
  writeTemporarySingleBandUint8Tiff,
} from "./support/page-objects";

// CT-141 / manual sections 8 (CT-082) and 23 (CT-097): Invert is photographic-negative
// reflection within the data type's range (out = typeMax - in), NOT arithmetic negation.
// Bounded data (uint8, float [0,1]) inverts directly in one step and is its own inverse;
// unbounded data (e.g. after Standardize) is NOT blocked but auto-normalized to [0,1]
// then inverted, emitting TWO outputs (the normalized stack and the normalized+inverted
// stack) with BOTH steps recorded in History. All assertions read the TRUE status-bar
// readout, never the rendered color (display clips, data does not).

const INVERT = "Invert";
const NORMALIZE = "Normalize";
const STANDARDIZE = "Standardize";
const PANEL = 1;
const UINT8_BYTE_MAX = 255;
const UNIT_MAX = 1;
const FLOAT_TOLERANCE = 1e-3;

// In new-panel mode (the default) the primary result (normalized+inverted) lands in the
// lowest empty cell and the secondary output (the auto-normalized stack) in the next, so
// starting from a 2x2 grid with the source in panel 1 places them deterministically.
const NORMALIZED_THEN_INVERTED_PANEL = 2;
const AUTO_NORMALIZED_PANEL = 3;
const AUTO_NORMALIZED_LABEL = "Normalize to [0,1] (auto for invert)";

const MULTIBAND_DIMS = { width: multiBandTiff.width, height: multiBandTiff.height };
const UINT8_DIMS = { width: UINT8_FIXTURE_SIDE, height: UINT8_FIXTURE_SIDE };

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("inverts bounded 8-bit data to exactly 255 - v and is its own inverse", async () => {
  const uint8TiffPath = await writeTemporarySingleBandUint8Tiff();
  await loadImageFromAbsolutePath(launched.window, uint8TiffPath);
  await selectPanel(launched.window, PANEL);

  await invertInPlace();
  await expectUint8ReadoutAt(0, 0, UINT8_BYTE_MAX - uint8FixtureValueAt(0, 0));
  await expectUint8ReadoutAt(3, 3, UINT8_BYTE_MAX - uint8FixtureValueAt(3, 3));
  await expectMetadataDataTypeAndDimensions(launched.window, { dataType: "uint8", width: 4, height: 4 });

  await invertInPlace();
  await expectUint8ReadoutAt(0, 0, uint8FixtureValueAt(0, 0));
  await expectUint8ReadoutAt(3, 3, uint8FixtureValueAt(3, 3));
});

test("inverts bounded float [0,1] data to exactly 1 - v", async () => {
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, PANEL);
  await normalizeFullCubeInPlace();

  const normalizedTopLeft = await readFloatReadoutAt(PANEL, 0, 0);
  const normalizedBottomRight = await readFloatReadoutAt(PANEL, 3, 3);

  await invertInPlace();
  await expectFloatReadoutAt(PANEL, 0, 0, UNIT_MAX - normalizedTopLeft);
  await expectFloatReadoutAt(PANEL, 3, 3, UNIT_MAX - normalizedBottomRight);
  await expectMetadataDataTypeAndDimensions(launched.window, { dataType: "float32", width: 4, height: 4 });
});

test("auto-normalizes then inverts unbounded data, emitting two recorded outputs", async () => {
  await selectGridLayout(launched.window, "2x2");
  await clickGridBackgroundToClearSelection(launched.window);
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, PANEL);
  await standardizeToUnboundedInPlace();

  await openOperation(launched.window, INVERT);
  await applyOperation(launched.window, INVERT);

  await expectTwoInvertOutputsExist();
  await expectBothInvertStepsRecorded();
  await expectInvertedEqualsOneMinusNormalized();
});

async function invertInPlace(): Promise<void> {
  await openOperation(launched.window, INVERT);
  await applyOperationInPlace(launched.window, INVERT);
}

async function normalizeFullCubeInPlace(): Promise<void> {
  await openOperation(launched.window, NORMALIZE);
  await selectFullStackScope(launched.window, NORMALIZE);
  await applyOperationInPlace(launched.window, NORMALIZE);
}

async function standardizeToUnboundedInPlace(): Promise<void> {
  await openOperation(launched.window, STANDARDIZE);
  await selectFullStackScope(launched.window, STANDARDIZE);
  await setOperationNumberParameter(launched.window, STANDARDIZE, "Target mean", 0);
  await setOperationNumberParameter(launched.window, STANDARDIZE, "Target standard deviation", 1);
  await applyOperationInPlace(launched.window, STANDARDIZE);
}

async function expectTwoInvertOutputsExist(): Promise<void> {
  await expectPanelHoldsFile(launched.window, NORMALIZED_THEN_INVERTED_PANEL, multiBandTiff.fileName);
  await expectPanelHoldsFile(launched.window, AUTO_NORMALIZED_PANEL, multiBandTiff.fileName);
  await expectPanelIsEmpty(launched.window, 4);
}

async function expectBothInvertStepsRecorded(): Promise<void> {
  await selectPanel(launched.window, AUTO_NORMALIZED_PANEL);
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: INVERT,
    detailSubstrings: [AUTO_NORMALIZED_LABEL],
  });
  await selectPanel(launched.window, NORMALIZED_THEN_INVERTED_PANEL);
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: INVERT,
    detailSubstrings: ["Invert (band 1)"],
  });
}

async function expectInvertedEqualsOneMinusNormalized(): Promise<void> {
  const normalized = await readFloatReadoutAt(AUTO_NORMALIZED_PANEL, 3, 3);
  expect(normalized).toBeGreaterThan(0);
  expect(normalized).toBeLessThan(1);
  await expectFloatReadoutAt(NORMALIZED_THEN_INVERTED_PANEL, 3, 3, UNIT_MAX - normalized);
}

async function readFloatReadoutAt(panel: number, imageX: number, imageY: number): Promise<number> {
  const readout = await readPixelValueAt(launched.window, panel, imageX, imageY, MULTIBAND_DIMS);
  return Number.parseFloat(readout.value);
}

async function expectFloatReadoutAt(
  panel: number,
  imageX: number,
  imageY: number,
  expected: number,
): Promise<void> {
  await expectPixelReadoutToEqual(launched.window, {
    panel,
    imageX,
    imageY,
    dimensions: MULTIBAND_DIMS,
    expected,
    tolerance: FLOAT_TOLERANCE,
  });
}

async function expectUint8ReadoutAt(imageX: number, imageY: number, expected: number): Promise<void> {
  await expectPixelReadoutToEqual(launched.window, {
    panel: PANEL,
    imageX,
    imageY,
    dimensions: UINT8_DIMS,
    expected,
  });
}
