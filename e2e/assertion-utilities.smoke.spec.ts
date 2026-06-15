import { test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import type { FixtureSamplePixel } from "./fixtures/fixture-manifest";
import { launchToolboxApp, closeToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperation,
  expectHistoryToRecordOperation,
  expectMetadataDataTypeAndDimensions,
  expectPixelReadoutToEqual,
  loadFixtureAsStack,
  openOperation,
  selectPanel,
} from "./support/page-objects";

// Smoke coverage for the CT-116 assertion utilities: it loads the 12-bit-in-uint16 stack
// and exercises every shared helper so a broken helper fails fast. The pixel and metadata
// helpers assert the loaded fixture's documented values (exact integer and within-tolerance
// readouts); the history helper asserts the entry an applied Bit Shift records. Numbers come
// from the fixture manifest, not hardcoded. (Whether an operation's NEW pixel values surface
// in the readout is a numeric-correctness concern verified by the per-operation stories, not
// by this helper smoke test.)

const PANEL = 1;
const DIMENSIONS = { width: multiBandTiff.width, height: multiBandTiff.height };
const TOP_LEFT = requireSamplePixel(0);
const BOTTOM_RIGHT = requireSamplePixel(1);
const NEAR_INTEGER_TOLERANCE = 0.5;

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

test.beforeAll(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, PANEL);
});

test.afterAll(async () => {
  await closeToolboxApp(launched);
});

test("metadata helper asserts the data type and dimensions", async () => {
  await expectMetadataDataTypeAndDimensions(launched.window, {
    dataType: multiBandTiff.dataType,
    width: multiBandTiff.width,
    height: multiBandTiff.height,
  });
});

test("pixel readout helper asserts exact integers and within-tolerance values", async () => {
  await expectPixelReadoutToEqual(launched.window, {
    panel: PANEL,
    imageX: TOP_LEFT.x,
    imageY: TOP_LEFT.y,
    dimensions: DIMENSIONS,
    expected: activeBandValueOf(TOP_LEFT),
  });
  await expectPixelReadoutToEqual(launched.window, {
    panel: PANEL,
    imageX: BOTTOM_RIGHT.x,
    imageY: BOTTOM_RIGHT.y,
    dimensions: DIMENSIONS,
    expected: activeBandValueOf(BOTTOM_RIGHT),
    tolerance: NEAR_INTEGER_TOLERANCE,
  });
});

test("history helper confirms an applied operation is recorded with its parameters", async () => {
  await openOperation(launched.window, "Bit Shift");
  await applyOperation(launched.window, "Bit Shift");
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: "Bit Shift",
    detailSubstrings: ["+4"],
  });
});
