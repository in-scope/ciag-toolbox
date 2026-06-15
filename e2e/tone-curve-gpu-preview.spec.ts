import { expect, test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import type { PixelDimensions } from "./support/page-objects";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  addToneCurveAnchorAtFraction,
  applyOperationInPlace,
  cancelOperation,
  dragToneCurveEndpointTo,
  expectHistoryToRecordOperation,
  expectMetadataDataTypeAndDimensions,
  expectToneCurveOpensWithTwoEndpoints,
  expectPixelReadoutToEqual,
  historyEntryCount,
  loadFixtureAsStack,
  nonClearPixelFraction,
  openOperation,
  panelCanvas,
  readImageTextureUploadCount,
  readPreviewRasterAllocationCount,
  selectPanel,
  summarizeCanvasPixels,
  TONE_CURVE_LABEL,
} from "./support/page-objects";

// CT-171: the tone-curve PREVIEW is display-only. Dragging an anchor uploads a small GPU
// lookup table and enables the shader's tone-curve branch instead of re-baking the band into
// a new raster. So a drag must (a) CHANGE what the canvas paints while leaving the pixel-readout
// DATA value untouched, (b) NOT re-upload the image texture across successive drags (proven by
// the dev-only render-instrumentation counter), and (c) only on Apply does the DATA change and a
// History entry land. Closing the panel clears the anchors, disabling the LUT (the untouched
// source returns). multiband-12bit.tif renders near-black by default (nonClearPixelFraction ~0),
// so brightening it via the curve is the ideal display-changed oracle with an exact (0,0)=100
// integer readout for the data-unchanged check.

const PANEL = 1;
const UINT16 = "uint16";
const FOUR_BY_FOUR: PixelDimensions = { width: multiBandTiff.width, height: multiBandTiff.height };
const UINT16_TYPE_MAX = 65535;
const RAW_TOP_LEFT_VALUE = 100;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, PANEL);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("dragging an anchor previews via the GPU LUT (display changes, data unchanged) and never re-uploads the image", async () => {
  await openOperation(launched.window, TONE_CURVE_LABEL);
  await expectToneCurveOpensWithTwoEndpoints(launched.window);
  const darkBaseline = await settledPanelNonClearFraction();
  await expectExactReadout({ x: 0, y: 0 }, RAW_TOP_LEFT_VALUE);
  const uploadsBeforeDrags = await readImageTextureUploadCount(launched.window);
  const previewRastersBeforeDrags = await readPreviewRasterAllocationCount(launched.window);
  await dragToneCurveEndpointTo(launched.window, "left", -0.2, -0.2);
  await expectPreviewBrightenedAbove(darkBaseline);
  await expectExactReadout({ x: 0, y: 0 }, RAW_TOP_LEFT_VALUE);
  expect(await historyEntryCount(launched.window)).toBe(0);
  await performTwoMoreAnchorEdits();
  await expectNoImageReuploadOrPreviewRaster(uploadsBeforeDrags, previewRastersBeforeDrags);
});

test("Apply bakes the previewed curve into the data and records one History entry", async () => {
  await openOperation(launched.window, TONE_CURVE_LABEL);
  await expectToneCurveOpensWithTwoEndpoints(launched.window);
  await dragToneCurveEndpointTo(launched.window, "left", -0.2, -0.2);
  await expectExactReadout({ x: 0, y: 0 }, RAW_TOP_LEFT_VALUE);
  await applyOperationInPlace(launched.window, TONE_CURVE_LABEL);
  await expectMetadataDataTypeAndDimensions(launched.window, { dataType: UINT16, width: 4, height: 4 });
  await expectExactReadout({ x: 0, y: 0 }, UINT16_TYPE_MAX);
  expect(await historyEntryCount(launched.window)).toBe(1);
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: TONE_CURVE_LABEL,
    detailSubstrings: ["points"],
  });
});

test("closing the tone-curve panel clears the anchors, disabling the LUT and restoring the untouched source", async () => {
  await openOperation(launched.window, TONE_CURVE_LABEL);
  await expectToneCurveOpensWithTwoEndpoints(launched.window);
  const darkBaseline = await settledPanelNonClearFraction();
  await dragToneCurveEndpointTo(launched.window, "left", -0.2, -0.2);
  await expectPreviewBrightenedAbove(darkBaseline);
  await cancelOperation(launched.window, TONE_CURVE_LABEL);
  await expectPreviewRestoredTo(darkBaseline);
  await expectExactReadout({ x: 0, y: 0 }, RAW_TOP_LEFT_VALUE);
});

// Two further distinct anchor edits prove "successive drags" do not accumulate image uploads:
// a second endpoint drag and a fresh interior anchor each touch only the LUT, not the texture.
async function performTwoMoreAnchorEdits(): Promise<void> {
  await dragToneCurveEndpointTo(launched.window, "left", 0.3, -0.2);
  await addToneCurveAnchorAtFraction(launched.window, 0.5, 0.5);
}

async function expectNoImageReuploadOrPreviewRaster(
  uploadsBefore: number,
  previewRastersBefore: number,
): Promise<void> {
  expect(await readImageTextureUploadCount(launched.window)).toBe(uploadsBefore);
  expect(await readPreviewRasterAllocationCount(launched.window)).toBe(previewRastersBefore);
}

async function expectExactReadout(pixel: { x: number; y: number }, expected: number): Promise<void> {
  await expectPixelReadoutToEqual(launched.window, {
    panel: PANEL,
    imageX: pixel.x,
    imageY: pixel.y,
    dimensions: FOUR_BY_FOUR,
    expected,
  });
}

async function settledPanelNonClearFraction(): Promise<number> {
  await launched.window.waitForTimeout(200);
  return panelNonClearFraction();
}

async function expectPreviewBrightenedAbove(baselineFraction: number): Promise<void> {
  await expect.poll(() => panelNonClearFraction()).toBeGreaterThan(baselineFraction + 0.1);
}

async function expectPreviewRestoredTo(baselineFraction: number): Promise<void> {
  await expect.poll(() => panelNonClearFraction()).toBeLessThan(baselineFraction + 0.05);
}

function panelNonClearFraction(): Promise<number> {
  return summarizeCanvasPixels(panelCanvas(launched.window, PANEL)).then(nonClearPixelFraction);
}
