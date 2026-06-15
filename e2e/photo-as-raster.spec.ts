import { expect, test } from "@playwright/test";

import { lowContrastGrayPng, rgbPng } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperationInPlace,
  cancelOperation,
  colorfulNonClearPixelFraction,
  expectHistoryToRecordOperation,
  expectMetadataDataTypeAndDimensions,
  expectPixelReadoutToEqual,
  expectToneCurveOpensWithTwoEndpoints,
  goToBandNumberInput,
  histogramSection,
  historyEntryCount,
  loadFixtureAsStack,
  nonClearPixelFraction,
  openOperation,
  panelCanvas,
  readMetadata,
  setToneCurveAnchorField,
  summarizeCanvasPixels,
  toneCurveEndpointHandles,
  TONE_CURVE_LABEL,
  type PixelDimensions,
} from "./support/page-objects";

// CT-172: a browser-decoded photo (PNG/JPG) is promoted to a raster AT LOAD, so it behaves
// like any other image - it renders as an RGB composite, hides the band navigator, exposes the
// Histogram panel and the Tone Curve operation, previews a curve display-only, and Apply bakes
// real pixels. A grayscale photo promotes to a SINGLE-band raster (no false rgb tag).
//
// FIXTURES: rgb.png (2x2, documented per-pixel R/G/B; (0,0)=(200,100,50)) is the colour case;
// low-contrast-gray.png (4x4 grayscale) is the single-band case. The tone-curve readout shows
// the selected band (band 0 = Red) for a composite, so the Apply oracle reads the Red channel.

const PANEL = 1;
const RGB_DIMENSIONS: PixelDimensions = { width: rgbPng.width, height: rgbPng.height };
const TOP_LEFT_RED_BEFORE = 200;
const UINT8_MIN = 0;
const COLORFUL_FRACTION_FLOOR = 0.3;
const PREVIEW_DARKEN_DELTA = 0.1;

let launched: LaunchedApp;

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("a loaded colour PNG renders as a composite with no band navigator and exposes the Histogram and Tone Curve", async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, rgbPng.fileName);
  await expectPanelRendersInColor();
  await expect(goToBandNumberInput(launched.window)).toHaveCount(0);
  await expect(histogramSection(launched.window)).toBeVisible();
  await openOperation(launched.window, TONE_CURVE_LABEL);
  await expectToneCurveOpensWithTwoEndpoints(launched.window);
  await cancelOperation(launched.window, TONE_CURVE_LABEL);
});

test("editing the tone curve previews on the colour photo (display only) and Apply bakes its pixels", async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, rgbPng.fileName);
  await openOperation(launched.window, TONE_CURVE_LABEL);
  await expectToneCurveOpensWithTwoEndpoints(launched.window);
  const brightBaseline = await panelNonClearFraction();
  expect(brightBaseline).toBeGreaterThan(COLORFUL_FRACTION_FLOOR);
  await flattenCurveOutputToBlack();
  await expectPreviewDarkenedBelow(brightBaseline);
  await expectRedReadoutAtTopLeft(TOP_LEFT_RED_BEFORE);
  expect(await historyEntryCount(launched.window)).toBe(0);
  await applyOperationInPlace(launched.window, TONE_CURVE_LABEL);
  await expectRedReadoutAtTopLeft(UINT8_MIN);
  await expectOneToneCurveHistoryEntry();
});

test("a loaded grayscale PNG is promoted to a single-band uint8 raster", async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, lowContrastGrayPng.fileName);
  await expectMetadataDataTypeAndDimensions(launched.window, {
    dataType: lowContrastGrayPng.dataType,
    width: lowContrastGrayPng.width,
    height: lowContrastGrayPng.height,
  });
  expect((await readMetadata(launched.window)).bandCount).toBe(String(lowContrastGrayPng.bandCount));
});

// Selecting the RIGHT endpoint and pulling its output to 0 makes the two-anchor curve flat at
// zero, so every input maps to black - a strong display-darkening preview that, on Apply, bakes
// the selected (Red) band to 0.
async function flattenCurveOutputToBlack(): Promise<void> {
  await toneCurveEndpointHandles(launched.window).last().click();
  await setToneCurveAnchorField(launched.window, "Output", UINT8_MIN);
}

async function expectPanelRendersInColor(): Promise<void> {
  await expect
    .poll(() => colorfulNonClearPixelFraction(panelCanvas(launched.window, PANEL)))
    .toBeGreaterThan(COLORFUL_FRACTION_FLOOR);
}

async function expectPreviewDarkenedBelow(baselineFraction: number): Promise<void> {
  await expect.poll(() => panelNonClearFraction()).toBeLessThan(baselineFraction - PREVIEW_DARKEN_DELTA);
}

async function expectRedReadoutAtTopLeft(expected: number): Promise<void> {
  await expectPixelReadoutToEqual(launched.window, {
    panel: PANEL,
    imageX: 0,
    imageY: 0,
    dimensions: RGB_DIMENSIONS,
    expected,
  });
}

async function expectOneToneCurveHistoryEntry(): Promise<void> {
  expect(await historyEntryCount(launched.window)).toBe(1);
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: TONE_CURVE_LABEL,
    detailSubstrings: ["points"],
  });
}

function panelNonClearFraction(): Promise<number> {
  return summarizeCanvasPixels(panelCanvas(launched.window, PANEL)).then(nonClearPixelFraction);
}
