import { expect, test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import {
  averageNonClearCanvasColor,
  nonClearPixelFraction,
  summarizeCanvasPixels,
} from "./support/canvas-pixels";
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
// that the readout preserves (data does not clip). The display no longer clamps those to a
// flat white/black frame: a float raster whose data falls outside [0,1] auto-fits its display
// window to the data's own extents (CT-161), so each band renders a VISIBLE gradient while the
// out-of-range true values survive in the readout.
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
// Auto-fit (CT-161) stretches the band's own min..max across black..white, so each band
// renders as a broadly-visible mid-tone gradient. The two thresholds below each reject one
// pre-CT-161 clip regime (RED measurements captured by forcing the old fixed-[0,1] window):
//   - below-zero band clipped to a near-black frame: non-clear fraction ~0.014, so > 0.2 rejects it
//   - above-one band clipped to a saturated-white frame: average luminance ~252, so < 200 rejects it
// Auto-fit lands at non-clear ~0.81 and luminance ~132 for both bands, clear of both bounds.
// (distinctColorCount is NOT used: edge anti-aliasing yields ~230-260 distinct colors even on a
// flat clipped frame, so it cannot tell a gradient from a clip.)
const AUTO_FIT_VISIBLE_MIN_FRACTION = 0.2;
const AUTO_FIT_MAX_LUMINANCE = 200;

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

test("Standardize with a large target std keeps out-of-range true values while the display auto-fits", async () => {
  await applyStandardizeWithLargeTargetStandardDeviation();

  await expectMetadataDataTypeAndDimensions(launched.window, {
    dataType: FLOAT32,
    width: multiBandTiff.width,
    height: multiBandTiff.height,
  });

  await expectActiveBandReadoutBelowZero(0, 0);
  await expectActiveBandDisplayAutoFitsToVisibleGradient();

  await selectActiveBandNumber(launched.window, 3);
  await expectActiveBandReadoutAboveOne(3, 3);
  await expectActiveBandDisplayAutoFitsToVisibleGradient();
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

async function expectActiveBandDisplayAutoFitsToVisibleGradient(): Promise<void> {
  await expect.poll(activeBandNonClearFraction).toBeGreaterThan(AUTO_FIT_VISIBLE_MIN_FRACTION);
  expect(await activeBandAverageLuminance()).toBeLessThan(AUTO_FIT_MAX_LUMINANCE);
}

async function activeBandNonClearFraction(): Promise<number> {
  return nonClearPixelFraction(await summarizeCanvasPixels(panelCanvas(launched.window, PANEL)));
}

async function activeBandAverageLuminance(): Promise<number> {
  const color = await averageNonClearCanvasColor(panelCanvas(launched.window, PANEL));
  return (color.red + color.green + color.blue) / 3;
}
