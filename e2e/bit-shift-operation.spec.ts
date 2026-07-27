import { expect, test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import type { FixtureSamplePixel } from "./fixtures/fixture-manifest";
import { applyScopeFieldset } from "./support/apply-scope-control";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import { operationRegionPlaceholder, selectOperationRegionButton } from "./support/operation-region-picker";
import {
  activateRegionTool,
  applyOperationInPlace,
  drawInspectionRoiBetweenPixels,
  ensureRegionToolInactive,
  expectHistoryToRecordOperation,
  expectMetadataDataTypeAndDimensions,
  expectPixelReadoutToEqual,
  loadFixtureAsStack,
  openOperation,
  operationPanel,
  selectPanel,
} from "./support/page-objects";

// CT-127 / manual section 15 / CT-030: Bit Shift on the 12-bit-in-16-bit fixture.
// Applying Bit Shift by 4 left-shifts every value (x16), so a known pixel's TRUE readout
// value multiplies by 16; the data type stays the integer container type (uint16, not
// promoted to float); and a History entry records the shift amount. Numbers come from the
// fixture manifest (multiband-12bit.tif), not hardcoded, so a fixture change updates once.
//
// CT-243: Bit Shift no longer offers a Region of interest scope (crop first instead).
// The panel must show neither the "Apply to" scope selector nor the region-picker
// affordance, and the shift must land on pixels OUTSIDE a previously drawn
// Region-tool box, proving the operation always applies to the whole stack.
//
// CT-249: the shift-amount description is Anna's wording; the exact copy is pinned here.

const PANEL = 1;
const BIT_SHIFT = "Bit Shift";
const SHIFT_AMOUNT_DESCRIPTION =
  "Brightens images from imaging systems that pack a smaller bit depth into a larger bit-depth file, such as 12-bit data in a 16-bit file. Each shift step doubles the values; for example, 4 shifts take 12-bit data to 16-bit.";
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

test("Bit Shift by 4 multiplies a known pixel's true value by 16, including outside a drawn Region-tool box", async () => {
  await expectActiveBandReadoutEquals(TOP_LEFT, activeBandValueOf(TOP_LEFT));
  await expectActiveBandReadoutEquals(BOTTOM_RIGHT, activeBandValueOf(BOTTOM_RIGHT));

  await drawRegionToolBoxAroundTopLeftCorner();

  await openOperation(launched.window, BIT_SHIFT);
  await expectBitShiftPanelOffersNoScopeOrRegionControls();
  await expectBitShiftPanelShowsTheShiftAmountDescription();
  await applyOperationInPlace(launched.window, BIT_SHIFT);

  await expectActiveBandReadoutEquals(TOP_LEFT, activeBandValueOf(TOP_LEFT) * SHIFT_MULTIPLIER);
  // BOTTOM_RIGHT sits outside the drawn box: the shift applies to the whole stack.
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

async function drawRegionToolBoxAroundTopLeftCorner(): Promise<void> {
  await activateRegionTool(launched.window);
  await drawInspectionRoiBetweenPixels(
    launched.window,
    PANEL,
    { x: TOP_LEFT.x, y: TOP_LEFT.y },
    { x: TOP_LEFT.x + 1, y: TOP_LEFT.y + 1 },
    DIMENSIONS,
  );
  await ensureRegionToolInactive(launched.window);
}

async function expectBitShiftPanelOffersNoScopeOrRegionControls(): Promise<void> {
  const page = launched.window;
  await expect(operationPanel(page, BIT_SHIFT)).toBeVisible();
  await expect(applyScopeFieldset(page, BIT_SHIFT)).toHaveCount(0);
  await expect(selectOperationRegionButton(page, BIT_SHIFT)).toHaveCount(0);
  await expect(operationRegionPlaceholder(page, BIT_SHIFT)).toHaveCount(0);
}

async function expectBitShiftPanelShowsTheShiftAmountDescription(): Promise<void> {
  await expect(operationPanel(launched.window, BIT_SHIFT)).toContainText(SHIFT_AMOUNT_DESCRIPTION);
}

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
