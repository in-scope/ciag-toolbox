import { test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  activateRegionTool,
  applyOperationInPlace,
  drawInspectionRoiBetweenPixels,
  expectMetadataDataTypeAndDimensions,
  expectOperationAwaitsItsOwnRegion,
  expectPixelReadoutToEqual,
  loadFixtureAsStack,
  openOperation,
  selectOperationRegionByDrag,
  selectPanel,
} from "./support/page-objects";

// CT-130 / manual section 21 (CT-095): Crop to Region uses the operation's OWN requested
// region, never the inspection ROI. With an inspection ROI sitting on screen, Crop to Region
// must prompt for a fresh region (Apply stays disabled until one is drawn), and cropping to a
// different sub-rectangle must shrink the Metadata dimensions and remap the crop's corners to
// the area the user actually selected - not the stale ROI. Numbers come from the manifest
// (multiband-12bit.tif, 4x4 3-band uint16, band 0 = 100 + (y*width + x)*10).

const PANEL = 1;
const CROP = "Crop to Region";
const SOURCE_DIMENSIONS = { width: multiBandTiff.width, height: multiBandTiff.height };

const INSPECTION_ROI_TOP_LEFT = { x: 0, y: 0 };
const INSPECTION_ROI_BOTTOM_RIGHT = { x: 1, y: 1 };

const CROP_REGION_TOP_LEFT = { x: 2, y: 2 };
const CROP_REGION_BOTTOM_RIGHT = { x: 3, y: 3 };
const CROPPED_DIMENSIONS = { width: 2, height: 2 };

// Cropping source pixels (2,2)-(3,3) makes the crop's top-left read source (2,2) and its
// bottom-right read source (3,3); band 0 = 100 + (y*width + x)*10 per the fixture generator.
const CROPPED_TOP_LEFT_EXPECTED_VALUE =
  100 + (CROP_REGION_TOP_LEFT.y * multiBandTiff.width + CROP_REGION_TOP_LEFT.x) * 10;
const CROPPED_BOTTOM_RIGHT_EXPECTED_VALUE = bottomRightSourceBandZeroValue();

let launched: LaunchedApp;

function bottomRightSourceBandZeroValue(): number {
  const pixel = multiBandTiff.samplePixels[1];
  const value = pixel?.valuesPerBand[0];
  if (value === undefined) throw new Error("multiBandTiff has no documented (3,3) sample value");
  return value;
}

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, PANEL);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("Crop to Region requests its own region instead of consuming an inspection ROI", async () => {
  await drawInspectionRoiTopLeft();
  await openOperation(launched.window, CROP);
  await expectOperationAwaitsItsOwnRegion(launched.window, CROP);
});

test("cropping a sub-rectangle shrinks the dimensions and remaps the corners", async () => {
  await drawInspectionRoiTopLeft();
  await openOperation(launched.window, CROP);
  await selectCropRegionBottomRight();
  await applyOperationInPlace(launched.window, CROP);
  await expectCroppedDimensionsAndCorners();
});

async function drawInspectionRoiTopLeft(): Promise<void> {
  await activateRegionTool(launched.window);
  await drawInspectionRoiBetweenPixels(
    launched.window,
    PANEL,
    INSPECTION_ROI_TOP_LEFT,
    INSPECTION_ROI_BOTTOM_RIGHT,
    SOURCE_DIMENSIONS,
  );
}

async function selectCropRegionBottomRight(): Promise<void> {
  await selectOperationRegionByDrag(launched.window, {
    panelNumber: PANEL,
    operationLabel: CROP,
    startPixel: CROP_REGION_TOP_LEFT,
    endPixel: CROP_REGION_BOTTOM_RIGHT,
    imageDimensions: SOURCE_DIMENSIONS,
  });
}

async function expectCroppedDimensionsAndCorners(): Promise<void> {
  await expectMetadataDataTypeAndDimensions(launched.window, {
    dataType: multiBandTiff.dataType,
    width: CROPPED_DIMENSIONS.width,
    height: CROPPED_DIMENSIONS.height,
  });
  await expectCroppedCornerReadout({ x: 0, y: 0 }, CROPPED_TOP_LEFT_EXPECTED_VALUE);
  await expectCroppedCornerReadout({ x: 1, y: 1 }, CROPPED_BOTTOM_RIGHT_EXPECTED_VALUE);
}

async function expectCroppedCornerReadout(
  corner: { x: number; y: number },
  expected: number,
): Promise<void> {
  await expectPixelReadoutToEqual(launched.window, {
    panel: PANEL,
    imageX: corner.x,
    imageY: corner.y,
    dimensions: CROPPED_DIMENSIONS,
    expected,
  });
}
