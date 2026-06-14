import { test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import type { FixtureSamplePixel } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperationInPlace,
  expectHistoryToRecordOperation,
  expectMetadataDataTypeAndDimensions,
  expectPixelReadoutToEqual,
  loadFixtureAsStack,
  openOperation,
  selectPanel,
} from "./support/page-objects";

// CT-127 / manual section 15 / CT-030: Bit Shift on the 12-bit-in-16-bit fixture.
// Applying Bit Shift by 4 left-shifts every value (x16), so a known pixel's TRUE readout
// value multiplies by 16; the data type stays the integer container type (uint16, not
// promoted to float); and a History entry records the shift amount. Numbers come from the
// fixture manifest (multiband-12bit.tif), not hardcoded, so a fixture change updates once.

const PANEL = 1;
const BIT_SHIFT = "Bit Shift";
const DEFAULT_SHIFT_AMOUNT = 4;
const SHIFT_MULTIPLIER = 2 ** DEFAULT_SHIFT_AMOUNT;
const DIMENSIONS = { width: multiBandTiff.width, height: multiBandTiff.height };

let launched: LaunchedApp;

function requireSamplePixel(index: number): FixtureSamplePixel {
  const pixel = multiBandTiff.samplePixels[index];
  if (!pixel) throw new Error(`multiBandTiff has no sample pixel at index ${index}`);
  return pixel;
}

function activeBandValueOf(pixel: FixtureSamplePixel): number {
  const value = pixel.valuesPerBand[0];
  if (value === undefined) throw new Error("Sample pixel has no first-band value");
  return value;
}

const TOP_LEFT = requireSamplePixel(0);
const BOTTOM_RIGHT = requireSamplePixel(1);

test.beforeAll(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, PANEL);
});

test.afterAll(async () => {
  await closeToolboxApp(launched);
});

test("Bit Shift by 4 multiplies a known pixel's true value by 16", async () => {
  await expectActiveBandReadoutEquals(TOP_LEFT, activeBandValueOf(TOP_LEFT));
  await expectActiveBandReadoutEquals(BOTTOM_RIGHT, activeBandValueOf(BOTTOM_RIGHT));

  await openOperation(launched.window, BIT_SHIFT);
  await applyOperationInPlace(launched.window, BIT_SHIFT);

  await expectActiveBandReadoutEquals(TOP_LEFT, activeBandValueOf(TOP_LEFT) * SHIFT_MULTIPLIER);
  await expectActiveBandReadoutEquals(BOTTOM_RIGHT, activeBandValueOf(BOTTOM_RIGHT) * SHIFT_MULTIPLIER);
});

test("the shifted stack keeps its uint16 data type and dimensions", async () => {
  await expectMetadataDataTypeAndDimensions(launched.window, {
    dataType: multiBandTiff.dataType,
    width: multiBandTiff.width,
    height: multiBandTiff.height,
  });
});

test("History records the bit-shift amount", async () => {
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: BIT_SHIFT,
    detailSubstrings: [`+${DEFAULT_SHIFT_AMOUNT}`],
  });
});

async function expectActiveBandReadoutEquals(
  pixel: FixtureSamplePixel,
  expected: number,
): Promise<void> {
  await expectPixelReadoutToEqual(launched.window, {
    panel: PANEL,
    imageX: pixel.x,
    imageY: pixel.y,
    dimensions: DIMENSIONS,
    expected,
  });
}
