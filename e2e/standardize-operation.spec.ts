import { expect, test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperationInPlace,
  expectHistoryToRecordOperation,
  expectMetadataDataTypeAndDimensions,
  loadFixtureAsStack,
  openOperation,
  readPixelValueAt,
  selectActiveBandNumber,
  selectBandWiseScopeForBands,
  selectFullStackScope,
  setOperationNumberParameter,
} from "./support/page-objects";

// CT-143 / manual section 10 (CT-084): Standardize retargets a stack to a requested mean and
// standard deviation via a z-score remap (out = (v - mean) / std * targetStd + targetMean).
// Full stack uses one stack-wide mean/std; band-wise standardizes each entered band by its own
// mean/std. Output is a float32 raster (CT-077), so a large target std drives true values outside
// [0,1] that the readout preserves (data never clips) while the display clamps to black/white.
//
// FIXTURE SUBSTITUTION (no E2E-BUG, testFailureProtocol step 1): the manual standardizes the
// low-contrast PNG, but PNG/JPG load through the browser decode path as an image-bitmap with no
// per-band raster, so the operation has nothing to transform. The committed multi-band uint16
// raster (multiband-12bit.tif) is the deterministic oracle.
//
// STATS ORACLE (no E2E-BUG, testFailureProtocol step 1): AC1/AC3 suggest reading the cube/band
// mean+std from the Region/Histogram panels, but CT-092 removed every numeric min/max/mean from
// those panels (they show geometry / a histogram only). The status-bar readout reports the TRUE
// per-pixel value, so the spec derives mean+std from the per-pixel readouts (the suite's primary
// numeric oracle) instead.

const PANEL = 1;
const STANDARDIZE = "Standardize";
const FLOAT32 = "float32";
const DIMENSIONS = { width: multiBandTiff.width, height: multiBandTiff.height };
const TARGET_MEAN_LABEL = "Target mean";
const TARGET_STD_LABEL = "Target standard deviation";

const TARGET_MEAN = 0.5;
const TARGET_STD = 0.2;
const LARGE_TARGET_STD = 5;
const BAND_WISE_RANGE = "1,3";
const RETARGET_TOLERANCE_DIGITS = 2;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("Full-cube standardize retargets the whole-cube mean and std to the requested values", async () => {
  await applyFullCubeStandardize(TARGET_MEAN, TARGET_STD);

  await expectMetadataDataTypeAndDimensions(launched.window, {
    dataType: FLOAT32,
    width: multiBandTiff.width,
    height: multiBandTiff.height,
  });

  const cubeValues = await readWholeCubeValues();
  expect(meanOf(cubeValues)).toBeCloseTo(TARGET_MEAN, RETARGET_TOLERANCE_DIGITS);
  expect(populationStandardDeviationOf(cubeValues)).toBeCloseTo(TARGET_STD, RETARGET_TOLERANCE_DIGITS);
});

test("A large target std drives true values outside [0,1] in the readout (data never clips)", async () => {
  await applyFullCubeStandardize(TARGET_MEAN, LARGE_TARGET_STD);

  await selectActiveBandNumber(launched.window, 1);
  expect(await readActiveBandValueAt(0, 0)).toBeLessThan(0);

  await selectActiveBandNumber(launched.window, 3);
  expect(await readActiveBandValueAt(3, 3)).toBeGreaterThan(1);
});

test("Band-wise standardize hits the targets per band and records scope and both targets in History", async () => {
  await applyBandWiseStandardize(BAND_WISE_RANGE, TARGET_MEAN, TARGET_STD);

  await expectBandRetargetedTo(1, TARGET_MEAN, TARGET_STD);
  await expectBandRetargetedTo(3, TARGET_MEAN, TARGET_STD);

  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: STANDARDIZE,
    detailSubstrings: ["band-wise: bands 1,3", "mean 0.5", "std 0.2"],
  });
});

async function applyFullCubeStandardize(targetMean: number, targetStd: number): Promise<void> {
  await openOperation(launched.window, STANDARDIZE);
  await selectFullStackScope(launched.window, STANDARDIZE);
  await setStandardizeTargets(targetMean, targetStd);
  await applyOperationInPlace(launched.window, STANDARDIZE);
}

async function applyBandWiseStandardize(
  bandRange: string,
  targetMean: number,
  targetStd: number,
): Promise<void> {
  await openOperation(launched.window, STANDARDIZE);
  await selectBandWiseScopeForBands(launched.window, STANDARDIZE, bandRange);
  await setStandardizeTargets(targetMean, targetStd);
  await applyOperationInPlace(launched.window, STANDARDIZE);
}

async function setStandardizeTargets(targetMean: number, targetStd: number): Promise<void> {
  await setOperationNumberParameter(launched.window, STANDARDIZE, TARGET_MEAN_LABEL, targetMean);
  await setOperationNumberParameter(launched.window, STANDARDIZE, TARGET_STD_LABEL, targetStd);
}

async function expectBandRetargetedTo(
  bandNumber: number,
  expectedMean: number,
  expectedStd: number,
): Promise<void> {
  await selectActiveBandNumber(launched.window, bandNumber);
  const bandValues = await readActiveBandPixelValues();
  expect(meanOf(bandValues)).toBeCloseTo(expectedMean, RETARGET_TOLERANCE_DIGITS);
  expect(populationStandardDeviationOf(bandValues)).toBeCloseTo(expectedStd, RETARGET_TOLERANCE_DIGITS);
}

async function readWholeCubeValues(): Promise<number[]> {
  const cubeValues: number[] = [];
  for (let bandNumber = 1; bandNumber <= multiBandTiff.bandCount; bandNumber += 1) {
    await selectActiveBandNumber(launched.window, bandNumber);
    cubeValues.push(...(await readActiveBandPixelValues()));
  }
  return cubeValues;
}

async function readActiveBandPixelValues(): Promise<number[]> {
  const bandValues: number[] = [];
  for (let imageY = 0; imageY < multiBandTiff.height; imageY += 1) {
    for (let imageX = 0; imageX < multiBandTiff.width; imageX += 1) {
      bandValues.push(await readActiveBandValueAt(imageX, imageY));
    }
  }
  return bandValues;
}

async function readActiveBandValueAt(imageX: number, imageY: number): Promise<number> {
  const readout = await readPixelValueAt(launched.window, PANEL, imageX, imageY, DIMENSIONS);
  return Number.parseFloat(readout.value);
}

function meanOf(values: ReadonlyArray<number>): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function populationStandardDeviationOf(values: ReadonlyArray<number>): number {
  const mean = meanOf(values);
  const variance =
    values.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / values.length;
  return Math.sqrt(variance);
}
