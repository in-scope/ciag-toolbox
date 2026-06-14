import { test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import type { PixelDimensions } from "./support/page-objects";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  activateRegionTool,
  applyOperationInPlace,
  drawInspectionRoiBetweenPixels,
  expectHistoryToRecordOperation,
  expectMetadataDataTypeAndDimensions,
  expectOperationAwaitsItsOwnRegion,
  expectPixelReadoutToEqual,
  loadFixtureAsStack,
  openOperation,
  selectOperationRegionByDrag,
  selectPanel,
  setOperationNumberParameter,
} from "./support/page-objects";

// CT-138 / manual section 5 (CT-079): Spectralon reflectance calibration. Per band
//   out = raw / W * reflectance   (W = the bright-target region's per-band mean; no dark ROI).
// The operation requests its OWN bright region - it never silently consumes the inspection ROI -
// and emits a float32 raster (CT-077) so out-of-range true values survive. The bright strip
// x=1..3, y=3 lies on the fixture's linear gradient, so its mean equals the CENTRE pixel (2,3);
// that pixel therefore calibrates to exactly the entered reflectance while dimmer pixels read
// fractions. Numbers come from the manifest (band 0 = 100 + (y*width + x)*10).

const PANEL = 1;
const FLOAT32 = "float32";
const READOUT_TOLERANCE = 0.001;
const FOUR_BY_FOUR: PixelDimensions = { width: multiBandTiff.width, height: multiBandTiff.height };
const SPECTRALON = "Spectralon Calibration";
const KNOWN_REFLECTANCE_FIELD = "Known reflectance";

const BRIGHT_REGION_START = { x: 1, y: 3 };
const BRIGHT_REGION_END = { x: 3, y: 3 };
const BRIGHT_REGION_CENTRE = { x: 2, y: 3 };
const DIM_PIXEL = { x: 0, y: 0 };

const INSPECTION_ROI_TOP_LEFT = { x: 0, y: 0 };
const INSPECTION_ROI_BOTTOM_RIGHT = { x: 1, y: 1 };

let launched: LaunchedApp;

function bandZeroValueAt(x: number, y: number): number {
  return 100 + (y * multiBandTiff.width + x) * 10;
}

// The 3-wide bright strip lies on a linear gradient, so its mean equals its centre pixel's value.
const BRIGHT_REGION_MEAN_BAND_ZERO =
  (bandZeroValueAt(1, 3) + bandZeroValueAt(2, 3) + bandZeroValueAt(3, 3)) / 3;

function calibratedBandZeroValue(rawBandZeroValue: number, reflectance: number): number {
  return (rawBandZeroValue / BRIGHT_REGION_MEAN_BAND_ZERO) * reflectance;
}

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, PANEL);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("requests its own bright region instead of consuming an inspection ROI", async () => {
  await drawInspectionRoiTopLeft();
  await openOperation(launched.window, SPECTRALON);
  await expectOperationAwaitsItsOwnRegion(launched.window, SPECTRALON);
});

test("knownReflectance 1 reads ~1.0 in the bright region and fractions elsewhere as float32", async () => {
  await calibrateWithBrightRegionAndReflectance(1);
  await expectMetadataDataTypeAndDimensions(launched.window, { dataType: FLOAT32, width: 4, height: 4 });
  await expectBandZeroReadout(BRIGHT_REGION_CENTRE, 1);
  await expectBandZeroReadout(DIM_PIXEL, calibratedBandZeroValue(bandZeroValueAt(0, 0), 1));
  await expectHistoryRecordsReflectance("1");
});

test("knownReflectance 0.99 scales every output by 0.99 and History records it", async () => {
  await calibrateWithBrightRegionAndReflectance(0.99);
  await expectBandZeroReadout(BRIGHT_REGION_CENTRE, 0.99);
  await expectBandZeroReadout(DIM_PIXEL, calibratedBandZeroValue(bandZeroValueAt(0, 0), 0.99));
  await expectHistoryRecordsReflectance("0.99");
});

async function calibrateWithBrightRegionAndReflectance(reflectance: number): Promise<void> {
  await openOperation(launched.window, SPECTRALON);
  await setOperationNumberParameter(launched.window, SPECTRALON, KNOWN_REFLECTANCE_FIELD, reflectance);
  await selectBrightRegion();
  await applyOperationInPlace(launched.window, SPECTRALON);
}

async function selectBrightRegion(): Promise<void> {
  await selectOperationRegionByDrag(launched.window, {
    panelNumber: PANEL,
    operationLabel: SPECTRALON,
    startPixel: BRIGHT_REGION_START,
    endPixel: BRIGHT_REGION_END,
    imageDimensions: FOUR_BY_FOUR,
  });
}

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

async function expectBandZeroReadout(pixel: { x: number; y: number }, expected: number): Promise<void> {
  await expectPixelReadoutToEqual(launched.window, {
    panel: PANEL,
    imageX: pixel.x,
    imageY: pixel.y,
    dimensions: FOUR_BY_FOUR,
    expected,
    tolerance: READOUT_TOLERANCE,
  });
}

async function expectHistoryRecordsReflectance(reflectanceText: string): Promise<void> {
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: SPECTRALON,
    detailSubstrings: [`reflectance ${reflectanceText}`, "(1, 3) - (3, 3)"],
  });
}
