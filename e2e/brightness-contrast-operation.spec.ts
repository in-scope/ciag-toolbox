import { expect, test } from "@playwright/test";

import { lowContrastGrayPng, multiBandTiff } from "./fixtures/fixture-manifest";
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
// (a fixture/units nuance, not a feature bug). CT-297: Contrast scales each pixel around
// the MIDDLE OF THE DATA RANGE, not the band's own mean (out = (in - mid) * ratio + mid,
// mid = 127.5 for uint8, 32767.5 for uint16). Both clip to the integer container range
// and never wrap. All expected numbers derive from the fixture manifest.

const PANEL = 1;
const DIMENSIONS = { width: multiBandTiff.width, height: multiBandTiff.height };
const UINT16_CONTAINER_MAX = 0xffff;
const UINT16_CONTAINER_SPAN = UINT16_CONTAINER_MAX - 0;
const TOP_LEFT = sampleAt(0);
const BOTTOM_RIGHT = sampleAt(1);
// CT-257: the log-symmetric contrast slider quantizes to round2(20^(0.01k)) stops, so
// exactly 2 is unreachable; 1.99 is its nearest stop and keeps the oracle exact.
const NEAR_DOUBLE_CONTRAST_RATIO = 1.99;

test.describe("with a uint16 multi-band stack", () => {
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

    await expectBandZeroReadout(launched, TOP_LEFT.x, TOP_LEFT.y, brightenedBandZeroValue(0, 20));
    await expectBandZeroReadout(launched, BOTTOM_RIGHT.x, BOTTOM_RIGHT.y, brightenedBandZeroValue(1, 20));
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
    await expectBandZeroReadout(launched, TOP_LEFT.x, TOP_LEFT.y, UINT16_CONTAINER_MAX);
    await expectBandZeroReadout(launched, BOTTOM_RIGHT.x, BOTTOM_RIGHT.y, UINT16_CONTAINER_MAX);
  });

  test("with Apply to all bands off, only the displayed band changes", async () => {
    await openOperation(launched.window, BRIGHTNESS_CONTRAST_LABEL);
    // CT-286 / CT-297: the switch explains that all-bands mode stretches each band
    // around the middle of its own data range.
    await expect(
      launched.window.getByText("Applies band-wise: every band is adjusted around the middle of its own data range.", {
        exact: true,
      }),
    ).toBeVisible();
    await setApplyToAllBands(launched.window, false);
    await setBrightnessContrastSlider(launched.window, BRIGHTNESS_SLIDER_LABEL, 20);
    await applyOperationInPlace(launched.window, BRIGHTNESS_CONTRAST_LABEL);

    await expectBandZeroReadout(launched, TOP_LEFT.x, TOP_LEFT.y, brightenedBandZeroValue(0, 20));
    await expectOtherBandUnchanged(launched, 2, 1);
    await expectOtherBandUnchanged(launched, 3, 2);
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

    await expectBandReadout(launched, 1, brightenedBandValue(TOP_LEFT, 0, 20));
    await expectBandReadout(launched, 2, brightenedBandValue(TOP_LEFT, 1, 20));
    await expectBandReadout(launched, 3, brightenedBandValue(TOP_LEFT, 2, 20));
    await expectHistoryToRecordOperation(launched.window, {
      actionLabel: BRIGHTNESS_CONTRAST_LABEL,
      detailSubstrings: ["Brightness +20%", "all bands"],
    });
  });
});

// CT-297: contrast now centres on the middle of the data-type range, not the band's
// own mean. low-contrast-gray.png (uint8, values 100..130) straddles the uint8
// midpoint (127.5) on both sides, so it is the exact oracle for the new formula -
// multiband-12bit.tif's values (100-1750) sit far below the uint16 midpoint
// (32767.5) and would clip to 0 at almost any contrast ratio.
test.describe("with a uint8 single-band image (contrast centring, CT-297)", () => {
  const FIXTURE = lowContrastGrayPng;
  const FIXTURE_DIMENSIONS = { width: FIXTURE.width, height: FIXTURE.height };
  const MIDPOINT = 127.5;
  const CONTRAST_TOP_LEFT = requireSamplePixel(FIXTURE, 0);
  const CONTRAST_BOTTOM_RIGHT = requireSamplePixel(FIXTURE, 1);

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchToolboxApp();
    await loadFixtureAsStack(launched.window, FIXTURE.fileName);
  });

  test.afterEach(async () => {
    await closeToolboxApp(launched);
  });

  test("Contrast stretches a pixel's distance from the middle of the data range by the slider ratio", async () => {
    await openOperation(launched.window, BRIGHTNESS_CONTRAST_LABEL);
    await setLogSymmetricContrastSlider(launched.window, NEAR_DOUBLE_CONTRAST_RATIO);
    await applyOperationInPlace(launched.window, BRIGHTNESS_CONTRAST_LABEL);

    // At ratio 1.99 (the log slider's nearest reachable stop to 2): 100 (dist -27.5
    // from 127.5) -> round(72.775) = 73; 130 (dist +2.5) -> round(132.475) = 132.
    // Scaling around the band's own mean (115) would instead give 71 / 130, which
    // these exact values rule out.
    await expectContrastReadout(0, 0, contrastedValue(CONTRAST_TOP_LEFT, NEAR_DOUBLE_CONTRAST_RATIO));
    await expectContrastReadout(3, 3, contrastedValue(CONTRAST_BOTTOM_RIGHT, NEAR_DOUBLE_CONTRAST_RATIO));
  });

  test("Contrast reaches 20x at the slider's End key and clips around the middle of the data range (CT-257)", async () => {
    await openOperation(launched.window, BRIGHTNESS_CONTRAST_LABEL);
    await maximizeBrightnessContrastSlider(launched.window, CONTRAST_SLIDER_LABEL);
    await expect(contrastSliderDisplayedValue(launched.window)).toHaveText("20");
    await applyOperationInPlace(launched.window, BRIGHTNESS_CONTRAST_LABEL);

    // clip((v - 127.5) * 20 + 127.5): 100 -> (100-127.5)*20+127.5 = -422.5, clipped
    // to 0; 130 -> (130-127.5)*20+127.5 = 177.5, in range and rounds to 178.
    await expectContrastReadout(0, 0, contrastedValue(CONTRAST_TOP_LEFT, 20));
    await expectContrastReadout(3, 3, contrastedValue(CONTRAST_BOTTOM_RIGHT, 20));
    await expectHistoryToRecordOperation(launched.window, {
      actionLabel: BRIGHTNESS_CONTRAST_LABEL,
      detailSubstrings: ["contrast 20.00"],
    });
  });

  function contrastedValue(pixel: { valuesPerBand: ReadonlyArray<number> }, contrastRatio: number): number {
    const original = pixel.valuesPerBand[0] ?? 0;
    return clampToUint8Container((original - MIDPOINT) * contrastRatio + MIDPOINT);
  }

  function clampToUint8Container(value: number): number {
    return Math.min(0xff, Math.max(0, Math.round(value)));
  }

  async function expectContrastReadout(imageX: number, imageY: number, expected: number): Promise<void> {
    await expectPixelReadoutToEqual(launched.window, {
      panel: PANEL,
      imageX,
      imageY,
      dimensions: FIXTURE_DIMENSIONS,
      expected,
    });
  }
});

function sampleAt(index: number): { x: number; y: number; valuesPerBand: ReadonlyArray<number> } {
  const pixel = multiBandTiff.samplePixels[index];
  if (!pixel) throw new Error(`multiBandTiff has no sample pixel at index ${index}`);
  return pixel;
}

function requireSamplePixel(
  fixture: { samplePixels: ReadonlyArray<{ x: number; y: number; valuesPerBand: ReadonlyArray<number> }> },
  index: number,
): { x: number; y: number; valuesPerBand: ReadonlyArray<number> } {
  const pixel = fixture.samplePixels[index];
  if (!pixel) throw new Error(`Fixture has no sample pixel at index ${index}`);
  return pixel;
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

async function expectBandZeroReadout(
  launched: LaunchedApp,
  imageX: number,
  imageY: number,
  expected: number,
): Promise<void> {
  await expectPixelReadoutToEqual(launched.window, {
    panel: PANEL,
    imageX,
    imageY,
    dimensions: DIMENSIONS,
    expected,
  });
}

async function expectBandReadout(launched: LaunchedApp, oneBasedBandNumber: number, expected: number): Promise<void> {
  await selectActiveBandNumber(launched.window, oneBasedBandNumber);
  await expectBandZeroReadout(launched, TOP_LEFT.x, TOP_LEFT.y, expected);
}

async function expectOtherBandUnchanged(
  launched: LaunchedApp,
  oneBasedBandNumber: number,
  bandIndex: number,
): Promise<void> {
  const original = TOP_LEFT.valuesPerBand[bandIndex];
  if (original === undefined) throw new Error(`Sample pixel has no band ${bandIndex} value`);
  await expectBandReadout(launched, oneBasedBandNumber, original);
}
