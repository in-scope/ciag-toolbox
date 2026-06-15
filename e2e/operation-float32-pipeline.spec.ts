import { expect, test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { nonClearPixelFraction, summarizeCanvasPixels } from "./support/canvas-pixels";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperationInPlace,
  expectMetadataDataTypeAndDimensions,
  expectPixelReadoutToEqual,
  loadFixtureAsStack,
  openOperation,
  panelCanvas,
  readPixelValueAt,
  selectActiveBandNumber,
  selectFullStackScope,
  setOperationNumberParameter,
} from "./support/page-objects";

// CT-136 / manual section 3 (CT-077): operation-produced float32 through the pipeline.
// Normalize turns an integer raster into a float32 [0,1] raster whose readout reports true
// fractional values; Standardize with a large target std drives true values above 1 / below 0
// that the readout preserves (data does not clip) while the display clamps to white/black.
//
// FIXTURE SUBSTITUTION (no E2E-BUG, testFailureProtocol step 1): the manual uses the
// low-contrast PNG. A PNG/JPG loads as an image-bitmap and, when an operation runs, is
// auto-promoted (CT-109) to an 8-bit 3-band RGB raster, so it CAN be transformed; but its values
// are then an 8-bit RGB decode, not a controlled oracle. The committed multi-band uint16 raster
// (multiband-12bit.tif) is the float-pipeline oracle: its documented integer values
// normalize/standardize to exact float results.

const PANEL = 1;
const NORMALIZE = "Normalize";
const STANDARDIZE = "Standardize";
const FLOAT32 = "float32";
const DIMENSIONS = { width: multiBandTiff.width, height: multiBandTiff.height };

// Full-cube normalize maps every value with one cube-wide min/max (100..1750), so
// out = (value - 100) / 1650. Band-0 (3,3)=250 and band-1 (0,0)=800 land mid-range.
const CUBE_MINIMUM = 100;
const CUBE_SPAN = 1650;
const NORMALIZED_BAND0_BOTTOM_RIGHT = (250 - CUBE_MINIMUM) / CUBE_SPAN;
const NORMALIZED_BAND1_TOP_LEFT = (800 - CUBE_MINIMUM) / CUBE_SPAN;
const FLOAT_READOUT_TOLERANCE = 0.001;

const TARGET_MEAN = 0.5;
const LARGE_TARGET_STD = 5;
const CLIPPED_BLACK_MAX_FRACTION = 0.05;
const CLIPPED_WHITE_MIN_FRACTION = 0.2;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("Normalize changes the data type to float32 and the readout shows fractional values", async () => {
  await openOperation(launched.window, NORMALIZE);
  await selectFullStackScope(launched.window, NORMALIZE);
  await applyOperationInPlace(launched.window, NORMALIZE);

  await expectMetadataDataTypeAndDimensions(launched.window, {
    dataType: FLOAT32,
    width: multiBandTiff.width,
    height: multiBandTiff.height,
  });

  await expectFractionalReadoutAt(3, 3, NORMALIZED_BAND0_BOTTOM_RIGHT);
  await selectActiveBandNumber(launched.window, 2);
  await expectFractionalReadoutAt(0, 0, NORMALIZED_BAND1_TOP_LEFT);
});

test("Standardize with a large target std keeps out-of-range true values while the display clips", async () => {
  await applyStandardizeWithLargeTargetStandardDeviation();

  await expectMetadataDataTypeAndDimensions(launched.window, {
    dataType: FLOAT32,
    width: multiBandTiff.width,
    height: multiBandTiff.height,
  });

  await expectActiveBandReadoutBelowZero(0, 0);
  await expectActiveBandDisplayClipsToBlack();

  await selectActiveBandNumber(launched.window, 3);
  await expectActiveBandReadoutAboveOne(3, 3);
  await expectActiveBandDisplayClipsToWhite();
});

async function applyStandardizeWithLargeTargetStandardDeviation(): Promise<void> {
  await openOperation(launched.window, STANDARDIZE);
  await selectFullStackScope(launched.window, STANDARDIZE);
  await setOperationNumberParameter(launched.window, STANDARDIZE, "Target mean", TARGET_MEAN);
  await setOperationNumberParameter(
    launched.window,
    STANDARDIZE,
    "Target standard deviation",
    LARGE_TARGET_STD,
  );
  await applyOperationInPlace(launched.window, STANDARDIZE);
}

async function expectFractionalReadoutAt(
  imageX: number,
  imageY: number,
  expected: number,
): Promise<void> {
  expect(expected).toBeGreaterThan(0);
  expect(expected).toBeLessThan(1);
  await expectPixelReadoutToEqual(launched.window, {
    panel: PANEL,
    imageX,
    imageY,
    dimensions: DIMENSIONS,
    expected,
    tolerance: FLOAT_READOUT_TOLERANCE,
  });
}

async function expectActiveBandReadoutBelowZero(imageX: number, imageY: number): Promise<void> {
  expect(await readActiveBandValueAt(imageX, imageY)).toBeLessThan(0);
}

async function expectActiveBandReadoutAboveOne(imageX: number, imageY: number): Promise<void> {
  expect(await readActiveBandValueAt(imageX, imageY)).toBeGreaterThan(1);
}

async function readActiveBandValueAt(imageX: number, imageY: number): Promise<number> {
  const readout = await readPixelValueAt(launched.window, PANEL, imageX, imageY, DIMENSIONS);
  return Number.parseFloat(readout.value);
}

async function expectActiveBandDisplayClipsToBlack(): Promise<void> {
  await expect.poll(activeBandNonClearFraction).toBeLessThan(CLIPPED_BLACK_MAX_FRACTION);
}

async function expectActiveBandDisplayClipsToWhite(): Promise<void> {
  await expect.poll(activeBandNonClearFraction).toBeGreaterThan(CLIPPED_WHITE_MIN_FRACTION);
}

async function activeBandNonClearFraction(): Promise<number> {
  return nonClearPixelFraction(await summarizeCanvasPixels(panelCanvas(launched.window, PANEL)));
}
