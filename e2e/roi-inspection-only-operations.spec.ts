import { test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import type { PixelDimensions } from "./support/page-objects";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  activateRegionTool,
  applyOperationInPlace,
  dragToneCurveEndpointTo,
  drawInspectionRoiBetweenPixels,
  expectMetadataDataTypeAndDimensions,
  expectOperationAwaitsItsOwnRegion,
  expectPixelReadoutToEqual,
  expectToneCurveOpensWithTwoEndpoints,
  loadFixtureAsStack,
  openOperation,
  selectOperationRegionByDrag,
  selectPanel,
  selectRegionOfInterestScope,
  setOperationNumberParameter,
  TONE_CURVE_LABEL,
} from "./support/page-objects";

// CT-154 / manual section 21 (CT-095): the ROI/operation separation, verified across ALL
// three region-using operations at once. The inspection ROI tool drives inspection only;
// Crop to Region, the Tone Curve's region scope, and Spectralon's reference patch each ask
// for their OWN region through one shared region-request flow, even with a stale inspection
// ROI sitting on screen. Two contracts per operation:
//   (1) it prompts for its own region (the shared "Select a region..." placeholder shows and
//       Apply stays disabled) instead of silently consuming the inspection ROI;
//   (2) it uses the FRESHLY selected region, not the pre-existing inspection ROI.
//
// The inspection ROI sits top-left (0,0)-(1,1); every operation's fresh region is bottom-right
// (2,2)-(3,3). An outcome that matches the bottom-right area but contradicts what consuming the
// top-left ROI would have produced proves the stale ROI was ignored. Numbers come from the
// manifest (multiband-12bit.tif, 4x4 3-band uint16, band 0 = 100 + (y*width + x)*10).

const PANEL = 1;
const FOUR_BY_FOUR: PixelDimensions = { width: multiBandTiff.width, height: multiBandTiff.height };
const UINT16 = "uint16";
const FLOAT32 = "float32";
const UINT16_TYPE_MAX = 65535;
const READOUT_TOLERANCE = 0.001;

const CROP = "Crop to Region";
const SPECTRALON = "Spectralon Calibration";
const KNOWN_REFLECTANCE_FIELD = "Known reflectance";

const INSPECTION_ROI_TOP_LEFT = { x: 0, y: 0 };
const INSPECTION_ROI_BOTTOM_RIGHT = { x: 1, y: 1 };
const FRESH_REGION_TOP_LEFT = { x: 2, y: 2 };
const FRESH_REGION_BOTTOM_RIGHT = { x: 3, y: 3 };
const CROPPED_DIMENSIONS: PixelDimensions = { width: 2, height: 2 };

let launched: LaunchedApp;

function bandZeroValueAt(x: number, y: number): number {
  return 100 + (y * multiBandTiff.width + x) * 10;
}

// The fresh region's per-band mean is the Spectralon reference W. Reading 100/225 at a pixel
// OUTSIDE the region proves W came from the bottom-right region, not the stale ROI (W=125).
const FRESH_REGION_BAND_ZERO_MEAN =
  (bandZeroValueAt(2, 2) + bandZeroValueAt(3, 2) + bandZeroValueAt(2, 3) + bandZeroValueAt(3, 3)) / 4;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, PANEL);
  await drawInspectionRoiTopLeft();
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("Crop to Region requests its own region and crops the fresh bottom-right area", async () => {
  await openOperation(launched.window, CROP);
  await expectOperationAwaitsItsOwnRegion(launched.window, CROP);
  await selectFreshBottomRightRegion(CROP);
  await applyOperationInPlace(launched.window, CROP);
  await expectMetadataDataTypeAndDimensions(launched.window, {
    dataType: UINT16,
    width: CROPPED_DIMENSIONS.width,
    height: CROPPED_DIMENSIONS.height,
  });
  await expectCroppedCornerReadout({ x: 0, y: 0 }, bandZeroValueAt(2, 2));
});

test("Spectralon requests its own region and calibrates against the fresh region mean", async () => {
  await openOperation(launched.window, SPECTRALON);
  await setOperationNumberParameter(launched.window, SPECTRALON, KNOWN_REFLECTANCE_FIELD, 1);
  await expectOperationAwaitsItsOwnRegion(launched.window, SPECTRALON);
  await selectFreshBottomRightRegion(SPECTRALON);
  await applyOperationInPlace(launched.window, SPECTRALON);
  await expectMetadataDataTypeAndDimensions(launched.window, { dataType: FLOAT32, width: 4, height: 4 });
  await expectFullImageReadout({ x: 0, y: 0 }, bandZeroValueAt(0, 0) / FRESH_REGION_BAND_ZERO_MEAN);
});

test("Tone Curve region scope requests its own region and remaps only the fresh area", async () => {
  await openOperation(launched.window, TONE_CURVE_LABEL);
  await expectToneCurveOpensWithTwoEndpoints(launched.window);
  await dragToneCurveEndpointTo(launched.window, "left", -0.2, -0.2);
  await selectRegionOfInterestScope(launched.window, TONE_CURVE_LABEL);
  await expectOperationAwaitsItsOwnRegion(launched.window, TONE_CURVE_LABEL);
  await selectFreshBottomRightRegion(TONE_CURVE_LABEL);
  await applyOperationInPlace(launched.window, TONE_CURVE_LABEL);
  await expectFullImageReadout({ x: 3, y: 3 }, UINT16_TYPE_MAX);
  await expectFullImageReadout({ x: 0, y: 0 }, bandZeroValueAt(0, 0));
});

async function drawInspectionRoiTopLeft(): Promise<void> {
  await activateRegionTool(launched.window);
  await drawInspectionRoiBetweenPixels(
    launched.window,
    PANEL,
    INSPECTION_ROI_TOP_LEFT,
    INSPECTION_ROI_BOTTOM_RIGHT,
    FOUR_BY_FOUR,
  );
}

async function selectFreshBottomRightRegion(operationLabel: string): Promise<void> {
  await selectOperationRegionByDrag(launched.window, {
    panelNumber: PANEL,
    operationLabel,
    startPixel: FRESH_REGION_TOP_LEFT,
    endPixel: FRESH_REGION_BOTTOM_RIGHT,
    imageDimensions: FOUR_BY_FOUR,
  });
}

async function expectCroppedCornerReadout(corner: { x: number; y: number }, expected: number): Promise<void> {
  await expectPixelReadoutToEqual(launched.window, {
    panel: PANEL,
    imageX: corner.x,
    imageY: corner.y,
    dimensions: CROPPED_DIMENSIONS,
    expected,
  });
}

async function expectFullImageReadout(pixel: { x: number; y: number }, expected: number): Promise<void> {
  await expectPixelReadoutToEqual(launched.window, {
    panel: PANEL,
    imageX: pixel.x,
    imageY: pixel.y,
    dimensions: FOUR_BY_FOUR,
    expected,
    tolerance: READOUT_TOLERANCE,
  });
}
