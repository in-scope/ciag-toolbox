import { test, expect } from "@playwright/test";

import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  activateRegionTool,
  applyGeometricTransformInPlace,
  drawInspectionRoiBetweenPixels,
  expectExactlyOneCommittedRoi,
  expectHistoryToRecordOperation,
  expectMetadataDataTypeAndDimensions,
  expectNoCommittedRoiMarkers,
  expectPixelReadoutToEqual,
  historyEntryCount,
  loadImageFromAbsolutePath,
  openRotateReflectFromMenu,
  readOfferedGeometricTransformLabels,
  regionSection,
  ROTATE_REFLECT_LABEL,
  selectActiveBandNumber,
  writeTemporaryMultiBandUint16Tiff,
  type ImagePixel,
  type PixelDimensions,
} from "./support/page-objects";

// CT-146 / manual section 13 (CT-087): Rotate & Reflect moves whole pixels without changing
// their values, applied to the ENTIRE cube at once so every band stays spatially aligned. A
// pixel at (x, y) in a W x H image lands at (H-1-y, x) under a 90 clockwise rotation, and 90
// rotations swap the reported width and height. Four 90 rotations, or two identical flips,
// restore the original exactly. An active inspection region must NOT survive at stale
// coordinates; History records each transform.
//
// FIXTURE: every committed fixture is 4x4 (square), so a 90 rotation would not visibly swap
// width/height. A throwaway NON-square 4x3 three-band uint16 stack makes the swap observable
// and, with each band carrying a distinct base offset, lets the band-alignment check prove the
// whole cube rotated together. Each pixel value is base + y*WIDTH + x, so every pixel is
// distinct and its rotated landing spot has an exact integer oracle.

const PANEL = 1;
const WIDTH = 4;
const HEIGHT = 3;
const BAND_COUNT = 3;
const BAND_BASES = [100, 200, 300];
const UINT16 = "uint16";
const ORIGINAL_DIMENSIONS: PixelDimensions = { width: WIDTH, height: HEIGHT };
const ROTATED_DIMENSIONS: PixelDimensions = { width: HEIGHT, height: WIDTH };

const EXPECTED_TRANSFORM_LABELS = [
  "Rotate 90 clockwise",
  "Rotate 180",
  "Rotate 270 clockwise",
  "Flip horizontal",
  "Flip vertical",
];

// On the 4x3 fixture, source (0, 0) lands at (H-1-0, 0) = (2, 0) and source (0, 2) lands at
// (H-1-2, 0) = (0, 0) under a 90 clockwise rotation.
const SOURCE_TOP_LEFT: ImagePixel = { x: 0, y: 0 };
const SOURCE_BOTTOM_RIGHT: ImagePixel = { x: WIDTH - 1, y: HEIGHT - 1 };
const ROTATED_LANDING_OF_TOP_LEFT: ImagePixel = { x: HEIGHT - 1, y: 0 };
const ROTATED_LANDING_OF_BOTTOM_LEFT: ImagePixel = { x: 0, y: 0 };

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("Rotate 90 offers the transform choices, swaps width/height, and lands a pixel at (H-1-y, x)", async () => {
  await loadNonSquareStackIntoPanelOne();
  await openRotateReflectFromMenu(launched.app, launched.window);
  expect(await readOfferedGeometricTransformLabels(launched.window)).toEqual(EXPECTED_TRANSFORM_LABELS);

  await applyGeometricTransformInPlace(launched.app, launched.window,"rotate-90-cw");
  await expectMetadataDataTypeAndDimensions(launched.window, { dataType: UINT16, width: HEIGHT, height: WIDTH });
  await expectBandPixelReadout(1, ROTATED_LANDING_OF_TOP_LEFT, sourceValue(1, SOURCE_TOP_LEFT), ROTATED_DIMENSIONS);
  await expectBandPixelReadout(1, ROTATED_LANDING_OF_BOTTOM_LEFT, sourceValue(1, { x: 0, y: HEIGHT - 1 }), ROTATED_DIMENSIONS);
});

test("four 90 rotations restore the original pixels and dimensions exactly", async () => {
  await loadNonSquareStackIntoPanelOne();
  for (let rotation = 0; rotation < 4; rotation += 1) {
    await applyGeometricTransformInPlace(launched.app, launched.window,"rotate-90-cw");
  }
  await expectStackMatchesUntouchedOriginal();
});

test("two horizontal flips restore the original pixels and dimensions exactly", async () => {
  await loadNonSquareStackIntoPanelOne();
  await applyGeometricTransformInPlace(launched.app, launched.window,"flip-horizontal");
  await applyGeometricTransformInPlace(launched.app, launched.window,"flip-horizontal");
  await expectStackMatchesUntouchedOriginal();
});

test("a 90 rotation transforms the whole cube keeping bands aligned and records each transform", async () => {
  await loadNonSquareStackIntoPanelOne();
  await applyGeometricTransformInPlace(launched.app, launched.window,"rotate-90-cw");
  await expectEveryBandRotatedTogetherAt(ROTATED_LANDING_OF_TOP_LEFT, SOURCE_TOP_LEFT);
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: ROTATE_REFLECT_LABEL,
    detailSubstrings: ["Rotate 90 clockwise"],
  });

  await applyGeometricTransformInPlace(launched.app, launched.window,"flip-horizontal");
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: ROTATE_REFLECT_LABEL,
    detailSubstrings: ["Flip horizontal"],
  });
  expect(await historyEntryCount(launched.window)).toBe(2);
});

test("an active inspection region is cleared after a geometric transform, never left at stale coordinates", async () => {
  await loadNonSquareStackIntoPanelOne();
  await activateRegionTool(launched.window);
  await drawInspectionRoiBetweenPixels(launched.window, PANEL, { x: 0, y: 0 }, { x: 1, y: 1 }, ORIGINAL_DIMENSIONS);
  await expectExactlyOneCommittedRoi(launched.window, PANEL);

  await applyGeometricTransformInPlace(launched.app, launched.window,"rotate-90-cw");
  await expectNoCommittedRoiMarkers(launched.window, PANEL);
  await expect(regionSection(launched.window)).toHaveCount(0);
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

async function expectEveryBandRotatedTogetherAt(
  rotatedPixel: ImagePixel,
  sourcePixel: ImagePixel,
): Promise<void> {
  for (let band = 1; band <= BAND_COUNT; band += 1) {
    await expectBandPixelReadout(band, rotatedPixel, sourceValue(band, sourcePixel), ROTATED_DIMENSIONS);
  }
}

async function expectStackMatchesUntouchedOriginal(): Promise<void> {
  await expectMetadataDataTypeAndDimensions(launched.window, { dataType: UINT16, width: WIDTH, height: HEIGHT });
  await expectBandPixelReadout(1, SOURCE_TOP_LEFT, sourceValue(1, SOURCE_TOP_LEFT), ORIGINAL_DIMENSIONS);
  await expectBandPixelReadout(1, SOURCE_BOTTOM_RIGHT, sourceValue(1, SOURCE_BOTTOM_RIGHT), ORIGINAL_DIMENSIONS);
}
