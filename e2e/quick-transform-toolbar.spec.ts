import { test, expect } from "@playwright/test";

import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyQuickGeometricTransform,
  expectHistoryToRecordOperation,
  expectMetadataDataTypeAndDimensions,
  expectPixelReadoutToEqual,
  loadImageFromAbsolutePath,
  operationPanel,
  quickTransformToolbarButton,
  ROTATE_REFLECT_LABEL,
  selectActiveBandNumber,
  writeTemporaryMultiBandUint16Tiff,
  type ImagePixel,
  type PixelDimensions,
} from "./support/page-objects";

// The toolbar's Transform group carries one-click variants of the rotate/reflect presets
// (Rotate 90° CW / CCW, Reflect H / V). Unlike the broad "Rotate & Reflect" operation (now
// menu-only, opens a panel), each quick button applies its transform IN PLACE immediately and
// never opens the operation panel. They reuse the same ROTATE_REFLECT action, so each records a
// History entry whose action label is "Rotate & Reflect" and whose detail is the preset's label.
//
// FIXTURE: a non-square 4x3 three-band uint16 stack makes the 90° width/height swap observable,
// with each pixel value (base + y*WIDTH + x) distinct so its landing spot has an exact oracle.

const PANEL = 1;
const WIDTH = 4;
const HEIGHT = 3;
const BAND_BASES = [100, 200, 300];
const UINT16 = "uint16";
const ORIGINAL_DIMENSIONS: PixelDimensions = { width: WIDTH, height: HEIGHT };
const ROTATED_DIMENSIONS: PixelDimensions = { width: HEIGHT, height: WIDTH };

const SOURCE_TOP_LEFT: ImagePixel = { x: 0, y: 0 };
const ROTATED_LANDING_OF_TOP_LEFT: ImagePixel = { x: HEIGHT - 1, y: 0 };
const FLIPPED_LANDING_OF_TOP_LEFT: ImagePixel = { x: WIDTH - 1, y: 0 };

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("the quick transform buttons disable on a fresh launch and enable once a stack loads", async () => {
  await expect(quickTransformToolbarButton(launched.window, "rotate-90-cw")).toBeDisabled();
  await expect(quickTransformToolbarButton(launched.window, "flip-vertical")).toBeDisabled();
  await loadNonSquareStackIntoPanelOne();
  await expect(quickTransformToolbarButton(launched.window, "rotate-90-cw")).toBeEnabled();
  await expect(quickTransformToolbarButton(launched.window, "flip-vertical")).toBeEnabled();
});

test("Rotate 90° clockwise applies in place, swaps width/height, and never opens the panel", async () => {
  await loadNonSquareStackIntoPanelOne();
  await applyQuickGeometricTransform(launched.window, "rotate-90-cw");
  await expect(operationPanel(launched.window, ROTATE_REFLECT_LABEL)).toHaveCount(0);
  await expectMetadataDataTypeAndDimensions(launched.window, { dataType: UINT16, width: HEIGHT, height: WIDTH });
  await expectBandPixelReadout(1, ROTATED_LANDING_OF_TOP_LEFT, sourceValue(1, SOURCE_TOP_LEFT), ROTATED_DIMENSIONS);
});

test("Reflect horizontally applies in place and lands a pixel at (W-1-x, y)", async () => {
  await loadNonSquareStackIntoPanelOne();
  await applyQuickGeometricTransform(launched.window, "flip-horizontal");
  await expectMetadataDataTypeAndDimensions(launched.window, { dataType: UINT16, width: WIDTH, height: HEIGHT });
  await expectBandPixelReadout(1, FLIPPED_LANDING_OF_TOP_LEFT, sourceValue(1, SOURCE_TOP_LEFT), ORIGINAL_DIMENSIONS);
});

test("two horizontal reflects restore the original pixels and dimensions exactly", async () => {
  await loadNonSquareStackIntoPanelOne();
  await applyQuickGeometricTransform(launched.window, "flip-horizontal");
  await applyQuickGeometricTransform(launched.window, "flip-horizontal");
  await expectMetadataDataTypeAndDimensions(launched.window, { dataType: UINT16, width: WIDTH, height: HEIGHT });
  await expectBandPixelReadout(1, SOURCE_TOP_LEFT, sourceValue(1, SOURCE_TOP_LEFT), ORIGINAL_DIMENSIONS);
});

test("a quick transform records the same History entry as the broad operation", async () => {
  await loadNonSquareStackIntoPanelOne();
  await applyQuickGeometricTransform(launched.window, "rotate-90-cw");
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: ROTATE_REFLECT_LABEL,
    detailSubstrings: ["Rotate 90 clockwise"],
  });
});

async function loadNonSquareStackIntoPanelOne(): Promise<void> {
  const filePath = await writeTemporaryMultiBandUint16Tiff({
    width: WIDTH,
    height: HEIGHT,
    bands: BAND_BASES.map(buildGradientBand),
  });
  await loadImageFromAbsolutePath(launched.window, filePath);
}

function buildGradientBand(base: number): number[] {
  return Array.from({ length: WIDTH * HEIGHT }, (_unused, index) => base + index);
}

function sourceValue(oneBasedBand: number, pixel: ImagePixel): number {
  return BAND_BASES[oneBasedBand - 1]! + pixel.y * WIDTH + pixel.x;
}

async function expectBandPixelReadout(
  oneBasedBand: number,
  pixel: ImagePixel,
  expected: number,
  dimensions: PixelDimensions,
): Promise<void> {
  await selectActiveBandNumber(launched.window, oneBasedBand);
  await expectPixelReadoutToEqual(launched.window, {
    panel: PANEL,
    imageX: pixel.x,
    imageY: pixel.y,
    dimensions,
    expected,
  });
}
