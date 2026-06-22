import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { flatFieldReferenceTiff, multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperation,
  applyOperationInPlace,
  countPanels,
  expectHistoryToRecordOperation,
  expectMetadataDataTypeAndDimensions,
  expectPanelHoldsFile,
  expectPixelReadoutToEqual,
  historyEntryCount,
  loadFixtureAsStack,
  openOperation,
  readMetadata,
  setOperationNumberParameter,
  type PixelDimensions,
} from "./support/page-objects";

// CT-144 / manual section 11 / CT-085: RGB to grayscale collapses a 3-band RGB raster into
// one band, gray = R*wR + G*wG + B*wB (clamped and rounded for integer rasters). Default
// weights are the luminance weights (0.299/0.587/0.114); custom 1/3 weights give the plain
// average. A non-RGB source is rejected with a clear toast, never a silent wrong result.
//
// FIXTURE SUBSTITUTION (no E2E-BUG): the committed rgb.png loads as an image-bitmap and, when an
// operation runs, is auto-promoted (CT-109) to an 8-bit 3-band RGB raster, so it CAN be converted;
// but its values are then an 8-bit decode, not controlled numbers. The 3-band uint16
// multiband-12bit.tif (bands treated as R/G/B) is the deterministic oracle, like the other specs.

const RGB_TO_GRAYSCALE_LABEL = "RGB to Grayscale";
const PANEL = 1;
const UINT16 = "uint16";
const FOUR_BY_FOUR: PixelDimensions = { width: multiBandTiff.width, height: multiBandTiff.height };
const LUMINANCE_WEIGHTS = { red: 0.299, green: 0.587, blue: 0.114 } as const;
const STRAIGHT_AVERAGE_WEIGHT = 0.3333;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("default luminance weights collapse a 3-band stack to one luminance band", async () => {
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await openOperation(launched.window, RGB_TO_GRAYSCALE_LABEL);
  await applyOperationInPlace(launched.window, RGB_TO_GRAYSCALE_LABEL);

  await expectSingleBandUint16Result();
  await expectGrayscaleReadout(0, 0, weightedGrayscaleAtSamplePixel(0, LUMINANCE_WEIGHTS));
  await expectGrayscaleReadout(3, 3, weightedGrayscaleAtSamplePixel(1, LUMINANCE_WEIGHTS));
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: RGB_TO_GRAYSCALE_LABEL,
    detailSubstrings: ["R 0.299", "G 0.587", "B 0.114"],
  });
});

test("custom 1/3 weights produce the plain average and History records the weights", async () => {
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await openOperation(launched.window, RGB_TO_GRAYSCALE_LABEL);
  await setEqualGrayscaleWeights(STRAIGHT_AVERAGE_WEIGHT);
  await applyOperationInPlace(launched.window, RGB_TO_GRAYSCALE_LABEL);

  await expectSingleBandUint16Result();
  await expectGrayscaleReadout(0, 0, averageGrayscaleAtSamplePixel(0));
  await expectGrayscaleReadout(3, 3, averageGrayscaleAtSamplePixel(1));
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: RGB_TO_GRAYSCALE_LABEL,
    detailSubstrings: ["R 0.333", "G 0.333", "B 0.333"],
  });
});

test("a non-RGB source is rejected with a clear toast and leaves the stack unchanged", async () => {
  await loadFixtureAsStack(launched.window, flatFieldReferenceTiff.fileName);
  await openOperation(launched.window, RGB_TO_GRAYSCALE_LABEL);
  await applyOperationInPlace(launched.window, RGB_TO_GRAYSCALE_LABEL);

  await expect(grayscaleErrorToast(launched.window)).toContainText("1 band");
  await expectMetadataDataTypeAndDimensions(launched.window, { dataType: UINT16, width: 4, height: 4 });
  await expectGrayscaleReadout(0, 0, flatFieldReferenceCornerValue());
  expect(await historyEntryCount(launched.window)).toBe(0);
});

// CT-190: with "Open in a new panel" ON (the default), a non-RGB source must NOT
// leave a blank result panel behind. The pre-flight applicability check fires the
// error toast BEFORE the apply flow reserves a panel or expands the grid, so the
// grid stays at its single source panel and no History entry is recorded.
test("a non-RGB source rejected on the new-panel path opens no blank panel", async () => {
  await loadFixtureAsStack(launched.window, flatFieldReferenceTiff.fileName);
  await openOperation(launched.window, RGB_TO_GRAYSCALE_LABEL);
  await applyOperation(launched.window, RGB_TO_GRAYSCALE_LABEL);

  await expect(grayscaleErrorToast(launched.window)).toContainText("1 band");
  expect(await countPanels(launched.window)).toBe(1);
  await expectPanelHoldsFile(launched.window, PANEL, flatFieldReferenceTiff.fileName);
  expect(await historyEntryCount(launched.window)).toBe(0);
});

async function expectSingleBandUint16Result(): Promise<void> {
  await expectMetadataDataTypeAndDimensions(launched.window, { dataType: UINT16, width: 4, height: 4 });
  const metadata = await readMetadata(launched.window);
  expect(metadata.bandCount).toBe("1");
}

async function expectGrayscaleReadout(imageX: number, imageY: number, expected: number): Promise<void> {
  await expectPixelReadoutToEqual(launched.window, {
    panel: PANEL,
    imageX,
    imageY,
    dimensions: FOUR_BY_FOUR,
    expected,
  });
}

async function setEqualGrayscaleWeights(weight: number): Promise<void> {
  await setOperationNumberParameter(launched.window, RGB_TO_GRAYSCALE_LABEL, "Red weight", weight);
  await setOperationNumberParameter(launched.window, RGB_TO_GRAYSCALE_LABEL, "Green weight", weight);
  await setOperationNumberParameter(launched.window, RGB_TO_GRAYSCALE_LABEL, "Blue weight", weight);
}

interface GrayscaleWeights {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

function weightedGrayscaleAtSamplePixel(samplePixelIndex: number, weights: GrayscaleWeights): number {
  const [red, green, blue] = rgbTripleAtSamplePixel(samplePixelIndex);
  return Math.round(red * weights.red + green * weights.green + blue * weights.blue);
}

function averageGrayscaleAtSamplePixel(samplePixelIndex: number): number {
  const [red, green, blue] = rgbTripleAtSamplePixel(samplePixelIndex);
  return Math.round((red + green + blue) * STRAIGHT_AVERAGE_WEIGHT);
}

function rgbTripleAtSamplePixel(samplePixelIndex: number): readonly [number, number, number] {
  const values = multiBandTiff.samplePixels[samplePixelIndex]?.valuesPerBand;
  if (!values || values.length < 3) throw new Error(`multiBandTiff sample pixel ${samplePixelIndex} is not 3-band`);
  return [values[0]!, values[1]!, values[2]!];
}

function flatFieldReferenceCornerValue(): number {
  const value = flatFieldReferenceTiff.samplePixels[0]?.valuesPerBand[0];
  if (value === undefined) throw new Error("flatFieldReferenceTiff (0,0) has no value");
  return value;
}

function grayscaleErrorToast(page: Page): Locator {
  return page.locator("[data-sonner-toast]").filter({ hasText: `${RGB_TO_GRAYSCALE_LABEL} failed` });
}
