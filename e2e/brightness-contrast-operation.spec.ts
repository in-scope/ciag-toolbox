import { expect, test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperationInPlace,
  expectHistoryToRecordOperation,
  expectMetadataDataTypeAndDimensions,
  expectPixelReadoutToEqual,
  loadFixtureAsStack,
  openOperation,
  selectActiveBandNumber,
} from "./support/page-objects";
import {
  BRIGHTNESS_CONTRAST_LABEL,
  BRIGHTNESS_SLIDER_LABEL,
  CONTRAST_SLIDER_LABEL,
  contrastSliderDisplayedValue,
  maximizeBrightnessContrastSlider,
  setApplyToAllBands,
  setBrightnessContrastSlider,
  setLogSymmetricContrastSlider,
} from "./support/brightness-contrast-controls";

// CT-140 / manual section 7 / CT-081: Brightness & Contrast verified numerically.
//
// The app's Brightness control is a slider measured in PERCENT of the data-type range
// (out = in + percent/100 * (typeMax - typeMin)), so manual 7.2's literal "+20" is the
// slider value in %, and on this uint16 fixture +20% adds exactly 20% of 65535 = 13107
// (a fixture/units nuance, not a feature bug). Contrast scales each pixel around the band
// mean (out = (in - mean) * ratio + mean). Both clip to the integer container range and
// never wrap. All expected numbers derive from the fixture manifest.

const PANEL = 1;
const DIMENSIONS = { width: multiBandTiff.width, height: multiBandTiff.height };
const UINT16_CONTAINER_MAX = 0xffff;
const UINT16_CONTAINER_SPAN = UINT16_CONTAINER_MAX - 0;
const TOP_LEFT = sampleAt(0);
const BOTTOM_RIGHT = sampleAt(1);
const BAND_ZERO_MEAN = requireBandMean(0);
// CT-257: the log-symmetric contrast slider quantizes to round2(20^(0.01k)) stops, so
// exactly 2 is unreachable; 1.99 is its nearest stop and keeps the oracle exact.
const NEAR_DOUBLE_CONTRAST_RATIO = 1.99;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("Brightness raises a known pixel by the slider's percent of the data-type range", async () => {
  await openOperation(launched.window, BRIGHTNESS_CONTRAST_LABEL);
  await setBrightnessContrastSlider(launched.window, BRIGHTNESS_SLIDER_LABEL, 20);
  await applyOperationInPlace(launched.window, BRIGHTNESS_CONTRAST_LABEL);

  await expectBandZeroReadout(TOP_LEFT.x, TOP_LEFT.y, brightenedBandZeroValue(0, 20));
  await expectBandZeroReadout(BOTTOM_RIGHT.x, BOTTOM_RIGHT.y, brightenedBandZeroValue(1, 20));
  await expectMetadataDataTypeAndDimensions(launched.window, {
    dataType: multiBandTiff.dataType,
    width: multiBandTiff.width,
    height: multiBandTiff.height,
  });
});

test("a pixel that would exceed the type maximum clips to the max instead of wrapping", async () => {
  await openOperation(launched.window, BRIGHTNESS_CONTRAST_LABEL);
  await maximizeBrightnessContrastSlider(launched.window, BRIGHTNESS_SLIDER_LABEL);
  await applyOperationInPlace(launched.window, BRIGHTNESS_CONTRAST_LABEL);

  // +100% adds 65535, so 100 -> 65635 and 250 -> 65785. Clipped reads exactly 65535;
  // a wrapped uint16 would read 99 / 249, which the exact assertion rules out.
  await expectBandZeroReadout(TOP_LEFT.x, TOP_LEFT.y, UINT16_CONTAINER_MAX);
  await expectBandZeroReadout(BOTTOM_RIGHT.x, BOTTOM_RIGHT.y, UINT16_CONTAINER_MAX);
});

test("Contrast stretches a pixel's distance from the band mean by the slider ratio", async () => {
  await openOperation(launched.window, BRIGHTNESS_CONTRAST_LABEL);
  await setLogSymmetricContrastSlider(launched.window, NEAR_DOUBLE_CONTRAST_RATIO);
  await applyOperationInPlace(launched.window, BRIGHTNESS_CONTRAST_LABEL);

  // The gradient fixture has no pixel exactly at the mean (175 sits between 170 and 180),
  // so the around-the-mean rule is proven by stretching a below-mean and an above-mean
  // pixel: at ratio 1.99 (the log slider's nearest reachable stop to 2), 100 (dist -75)
  // -> 26 and 250 (dist +75) -> 324. Scaling around zero would instead give 199 / 498,
  // which these exact values rule out.
  await expectBandZeroReadout(TOP_LEFT.x, TOP_LEFT.y, contrastedBandZeroValue(0, NEAR_DOUBLE_CONTRAST_RATIO));
  await expectBandZeroReadout(
    BOTTOM_RIGHT.x,
    BOTTOM_RIGHT.y,
    contrastedBandZeroValue(1, NEAR_DOUBLE_CONTRAST_RATIO),
  );
});

test("Contrast reaches 20x at the slider's End key and clips around the band mean (CT-257)", async () => {
  await openOperation(launched.window, BRIGHTNESS_CONTRAST_LABEL);
  await maximizeBrightnessContrastSlider(launched.window, CONTRAST_SLIDER_LABEL);
  await expect(contrastSliderDisplayedValue(launched.window)).toHaveText("20");
  await applyOperationInPlace(launched.window, BRIGHTNESS_CONTRAST_LABEL);

  // clip((v - mean) * 20 + mean) from the fixture values: 100 -> (100-175)*20+175 = -1325,
  // clipped to 0; 250 -> (250-175)*20+175 = 1675 (in range, exact).
  await expectBandZeroReadout(TOP_LEFT.x, TOP_LEFT.y, contrastedBandZeroValue(0, 20));
  await expectBandZeroReadout(BOTTOM_RIGHT.x, BOTTOM_RIGHT.y, contrastedBandZeroValue(1, 20));
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: BRIGHTNESS_CONTRAST_LABEL,
    detailSubstrings: ["contrast 20.00"],
  });
});

test("with Apply to all bands off, only the displayed band changes", async () => {
  await openOperation(launched.window, BRIGHTNESS_CONTRAST_LABEL);
  await setApplyToAllBands(launched.window, false);
  await setBrightnessContrastSlider(launched.window, BRIGHTNESS_SLIDER_LABEL, 20);
  await applyOperationInPlace(launched.window, BRIGHTNESS_CONTRAST_LABEL);

  await expectBandZeroReadout(TOP_LEFT.x, TOP_LEFT.y, brightenedBandZeroValue(0, 20));
  await expectOtherBandUnchanged(2, 1);
  await expectOtherBandUnchanged(3, 2);
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: BRIGHTNESS_CONTRAST_LABEL,
    detailSubstrings: ["Brightness +20%", "contrast 1.00", "band 1"],
  });
});

test("with Apply to all bands on, every band changes and History records the affected bands", async () => {
  await openOperation(launched.window, BRIGHTNESS_CONTRAST_LABEL);
  await setApplyToAllBands(launched.window, true);
  await setBrightnessContrastSlider(launched.window, BRIGHTNESS_SLIDER_LABEL, 20);
  await applyOperationInPlace(launched.window, BRIGHTNESS_CONTRAST_LABEL);

  await expectBandReadout(1, brightenedBandValue(TOP_LEFT, 0, 20));
  await expectBandReadout(2, brightenedBandValue(TOP_LEFT, 1, 20));
  await expectBandReadout(3, brightenedBandValue(TOP_LEFT, 2, 20));
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: BRIGHTNESS_CONTRAST_LABEL,
    detailSubstrings: ["Brightness +20%", "all bands"],
  });
});

function sampleAt(index: number): { x: number; y: number; valuesPerBand: ReadonlyArray<number> } {
  const pixel = multiBandTiff.samplePixels[index];
  if (!pixel) throw new Error(`multiBandTiff has no sample pixel at index ${index}`);
  return pixel;
}

function requireBandMean(bandIndex: number): number {
  const mean = multiBandTiff.bandMeans?.[bandIndex];
  if (mean === undefined) throw new Error(`multiBandTiff has no band mean at index ${bandIndex}`);
  return mean;
}

function clampToUint16Container(value: number): number {
  return Math.min(UINT16_CONTAINER_MAX, Math.max(0, Math.round(value)));
}

function brightenedBandZeroValue(sampleIndex: number, brightnessPercent: number): number {
  return brightenedBandValue(sampleAt(sampleIndex), 0, brightnessPercent);
}

function brightenedBandValue(
  pixel: { valuesPerBand: ReadonlyArray<number> },
  bandIndex: number,
  brightnessPercent: number,
): number {
  const original = pixel.valuesPerBand[bandIndex];
  if (original === undefined) throw new Error(`Sample pixel has no band ${bandIndex} value`);
  return clampToUint16Container(original + (brightnessPercent / 100) * UINT16_CONTAINER_SPAN);
}

function contrastedBandZeroValue(sampleIndex: number, contrastRatio: number): number {
  const original = sampleAt(sampleIndex).valuesPerBand[0] ?? 0;
  return clampToUint16Container((original - BAND_ZERO_MEAN) * contrastRatio + BAND_ZERO_MEAN);
}

async function expectBandZeroReadout(imageX: number, imageY: number, expected: number): Promise<void> {
  await expectPixelReadoutToEqual(launched.window, {
    panel: PANEL,
    imageX,
    imageY,
    dimensions: DIMENSIONS,
    expected,
  });
}

async function expectBandReadout(oneBasedBandNumber: number, expected: number): Promise<void> {
  await selectActiveBandNumber(launched.window, oneBasedBandNumber);
  await expectBandZeroReadout(TOP_LEFT.x, TOP_LEFT.y, expected);
}

async function expectOtherBandUnchanged(oneBasedBandNumber: number, bandIndex: number): Promise<void> {
  const original = TOP_LEFT.valuesPerBand[bandIndex];
  if (original === undefined) throw new Error(`Sample pixel has no band ${bandIndex} value`);
  await expectBandReadout(oneBasedBandNumber, original);
}
