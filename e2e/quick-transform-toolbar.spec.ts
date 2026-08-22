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
  REFLECT_LABEL,
  ROTATE_LABEL,
  selectActiveBandNumber,
  writeTemporaryMultiBandUint16Tiff,
  type ImagePixel,
  type PixelDimensions,
} from "./support/page-objects";

// The toolbar's Transform group carries one-click variants of the rotate/flip presets
// (Rotate 90° CW / CCW, Flip H / V). Unlike the broad "Rotate" and "Flip" operations (now
// menu-only, each opens a panel), every quick button applies its transform IN PLACE immediately
// and never opens an operation panel. The rotate presets reuse the Rotate action and the flip
// presets reuse the Flip action (CT-279 rename; internal id "reflect"), so each records a
// History entry whose action label is the matching operation name ("Rotate" or "Flip") and
// whose detail is the preset's label.
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
  await expect(operationPanel(launched.window, ROTATE_LABEL)).toHaveCount(0);
  await expectMetadataDataTypeAndDimensions(launched.window, { dataType: UINT16, width: HEIGHT, height: WIDTH });
  await expectBandPixelReadout(1, ROTATED_LANDING_OF_TOP_LEFT, sourceValue(1, SOURCE_TOP_LEFT), ROTATED_DIMENSIONS);
});

test("Flip horizontally applies in place and lands a pixel at (W-1-x, y)", async () => {
  await loadNonSquareStackIntoPanelOne();
  await applyQuickGeometricTransform(launched.window, "flip-horizontal");
  await expectMetadataDataTypeAndDimensions(launched.window, { dataType: UINT16, width: WIDTH, height: HEIGHT });
  await expectBandPixelReadout(1, FLIPPED_LANDING_OF_TOP_LEFT, sourceValue(1, SOURCE_TOP_LEFT), ORIGINAL_DIMENSIONS);
});

test("two horizontal flips restore the original pixels and dimensions exactly", async () => {
  await loadNonSquareStackIntoPanelOne();
  await applyQuickGeometricTransform(launched.window, "flip-horizontal");
  await applyQuickGeometricTransform(launched.window, "flip-horizontal");
  await expectMetadataDataTypeAndDimensions(launched.window, { dataType: UINT16, width: WIDTH, height: HEIGHT });
  await expectBandPixelReadout(1, SOURCE_TOP_LEFT, sourceValue(1, SOURCE_TOP_LEFT), ORIGINAL_DIMENSIONS);
});

test("a quick rotate records a Rotate History entry like the broad operation", async () => {
  await loadNonSquareStackIntoPanelOne();
  await applyQuickGeometricTransform(launched.window, "rotate-90-cw");
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: ROTATE_LABEL,
    detailSubstrings: ["Rotate 90 clockwise"],
  });
});

test("a quick flip records a Flip History entry like the broad operation", async () => {
  await loadNonSquareStackIntoPanelOne();
  await applyQuickGeometricTransform(launched.window, "flip-horizontal");
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: REFLECT_LABEL,
    detailSubstrings: ["Flip horizontal"],
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
