import { expect, test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperationInPlace,
  expectHistoryToRecordOperation,
  expectMetadataDataTypeAndDimensions,
  expectNormalizedViewingEnabled,
  expectPixelReadoutToEqual,
  historyEntryCount,
  loadFixtureAsStack,
  openOperation,
  selectActiveBandNumber,
  selectBandWiseScopeForBands,
  selectFullStackScope,
  toggleNormalizedViewing,
} from "./support/page-objects";

// CT-142 / manual section 9 (CT-083): Normalize verified for both locked scopes.
// FULL STACK scales every band by one stack-wide min/max, so only the cube's global extremes
// reach 0 and 1 and a dim band's own max stays below 1. BAND-WISE (all bands) scales each band
// by its OWN min/max, so every band individually spans 0..1. Output is float32, History records
// the chosen scope, and the display-only "Normalized viewing" toggle is a separate control that
// the data operation never touches and that records no History.
//
// FIXTURE SUBSTITUTION (no E2E-BUG, testFailureProtocol step 1): the manual normalizes the
// low-contrast PNG, but PNG/JPG load as an image-bitmap with no per-band raster, so operations
// have nothing to transform. The committed multi-band uint16 raster (multiband-12bit.tif) is the
// oracle: documented per-band values 100..250 / 800..950 / 1600..1750 (cube min 100, max 1750).

const PANEL = 1;
const NORMALIZE = "Normalize";
const FLOAT32 = "float32";
const ALL_BANDS_RANGE = "1-3";
const FULL_STACK_HISTORY_DETAIL = "full stack";
const ALL_BANDS_HISTORY_DETAIL = "band-wise: bands 1-3";
const DIMENSIONS = { width: multiBandTiff.width, height: multiBandTiff.height };
const FLOAT_READOUT_TOLERANCE = 0.001;

// Full-cube normalize: out = (value - 100) / 1650 across every band.
const CUBE_MINIMUM = 100;
const CUBE_SPAN = 1650;
const GLOBAL_MINIMUM_NORMALIZED = 0;
const GLOBAL_MAXIMUM_NORMALIZED = 1;
const DIM_BAND_MAXIMUM_NORMALIZED = (250 - CUBE_MINIMUM) / CUBE_SPAN; // band-0 (3,3) -> 0.0909

// Band-wise normalize: each band maps its OWN min->0 and max->1, so on this fixture every band's
// top-left (0,0) is that band's minimum (0) and bottom-right (3,3) is that band's maximum (1).
const ONE_BASED_BANDS = [1, 2, 3] as const;
const BAND_MINIMUM_PIXEL = { x: 0, y: 0 };
const BAND_MAXIMUM_PIXEL = { x: 3, y: 3 };

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("Full-stack normalize sends only the cube extremes to 0 and 1 and keeps a dim band below 1", async () => {
  await applyNormalizeWithScope(selectFullStackScope);

  await expectOutputIsFloat32();
  await expectActiveBandReadout(1, BAND_MINIMUM_PIXEL, GLOBAL_MINIMUM_NORMALIZED);
  await expectActiveBandReadout(3, BAND_MAXIMUM_PIXEL, GLOBAL_MAXIMUM_NORMALIZED);
  await expectActiveBandReadout(1, BAND_MAXIMUM_PIXEL, DIM_BAND_MAXIMUM_NORMALIZED);
});

test("Band-wise normalize over all bands makes every band individually span 0 to 1", async () => {
  await applyNormalizeOverAllBandsBandWise();

  await expectOutputIsFloat32();
  for (const bandNumber of ONE_BASED_BANDS) {
    await expectActiveBandReadout(bandNumber, BAND_MINIMUM_PIXEL, 0);
    await expectActiveBandReadout(bandNumber, BAND_MAXIMUM_PIXEL, 1);
  }
});

test("Normalize records the chosen scope and stays separate from the display-only Normalized viewing toggle", async () => {
  await expectNormalizedViewingEnabled(launched.window, PANEL, false);

  await applyNormalizeWithScope(selectFullStackScope);
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: NORMALIZE,
    detailSubstrings: [FULL_STACK_HISTORY_DETAIL],
  });
  expect(await historyEntryCount(launched.window)).toBe(1);

  await expectNormalizedViewingToggleAddsNoHistory();
});

test("Band-wise normalize records its band selection in History", async () => {
  await applyNormalizeOverAllBandsBandWise();
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: NORMALIZE,
    detailSubstrings: [ALL_BANDS_HISTORY_DETAIL],
  });
});

async function applyNormalizeWithScope(
  chooseScope: (page: LaunchedApp["window"], operationLabel: string) => Promise<void>,
): Promise<void> {
  await openOperation(launched.window, NORMALIZE);
  await chooseScope(launched.window, NORMALIZE);
  await applyOperationInPlace(launched.window, NORMALIZE);
}

async function applyNormalizeOverAllBandsBandWise(): Promise<void> {
  await openOperation(launched.window, NORMALIZE);
  await selectBandWiseScopeForBands(launched.window, NORMALIZE, ALL_BANDS_RANGE);
  await applyOperationInPlace(launched.window, NORMALIZE);
}

async function expectOutputIsFloat32(): Promise<void> {
  await expectMetadataDataTypeAndDimensions(launched.window, {
    dataType: FLOAT32,
    width: multiBandTiff.width,
    height: multiBandTiff.height,
  });
}

async function expectActiveBandReadout(
  oneBasedBandNumber: number,
  pixel: { x: number; y: number },
  expected: number,
): Promise<void> {
  await selectActiveBandNumber(launched.window, oneBasedBandNumber);
  await expectPixelReadoutToEqual(launched.window, {
    panel: PANEL,
    imageX: pixel.x,
    imageY: pixel.y,
    dimensions: DIMENSIONS,
    expected,
    tolerance: FLOAT_READOUT_TOLERANCE,
  });
}

async function expectNormalizedViewingToggleAddsNoHistory(): Promise<void> {
  await toggleNormalizedViewing(launched.window, PANEL);
  await expectNormalizedViewingEnabled(launched.window, PANEL, true);
  expect(await historyEntryCount(launched.window)).toBe(1);
}
