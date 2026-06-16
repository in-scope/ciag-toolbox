import { expect, test } from "@playwright/test";

import { rgbPng } from "./fixtures/fixture-manifest";
import type { PixelDimensions } from "./support/page-objects";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  averageNonClearCanvasColor,
  expectPixelReadoutToEqual,
  expectToneCurveOpensWithTwoEndpoints,
  historyEntryCount,
  loadFixtureAsStack,
  openOperation,
  panelCanvas,
  readImageTextureUploadCount,
  selectToneCurveChannel,
  setToneCurveAnchorField,
  toneCurveEndpointHandles,
  TONE_CURVE_LABEL,
} from "./support/page-objects";

// CT-177: a true-colour composite previews per-channel tone curves on the GPU. Editing
// the Red channel must (a) CHANGE what the canvas paints for the RED component only (the
// other channels barely move) while leaving the pixel-readout DATA value untouched
// (display-only), and (b) NOT re-upload the image texture across channel edits (proven by
// the CT-171 render-instrumentation counter). rgb.png (2x2, documented per-pixel R/G/B;
// (0,0)=(200,100,50)) is the colour case; averageNonClearCanvasColor isolates the rendered
// R/G/B so a red-only edit is observable channel by channel.

const PANEL = 1;
const RGB_DIMENSIONS: PixelDimensions = { width: rgbPng.width, height: rgbPng.height };
const TOP_LEFT_RED = 200;
const RED_RIGHT_ENDPOINT_HALF_OUTPUT = 128;
const GREEN_RIGHT_ENDPOINT_HALF_OUTPUT = 128;
const RED_DROP_FLOOR = 20;
const OTHER_CHANNEL_TOLERANCE = 15;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, rgbPng.fileName);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("editing the Red channel previews only the red component (display only) and never re-uploads the image", async () => {
  await openComposityToneCurveOnRedChannel();
  const before = await settledAverageCanvasColor();
  const uploadsBeforeEdits = await readImageTextureUploadCount(launched.window);
  await darkenActiveChannelRightEndpointTo(RED_RIGHT_ENDPOINT_HALF_OUTPUT);
  await expectRedComponentDroppedWhileGreenAndBlueHold(before);
  await expectTopLeftRedReadoutEquals(TOP_LEFT_RED);
  expect(await historyEntryCount(launched.window)).toBe(0);
  await editGreenChannelToProveSuccessiveEditsAreLutOnly();
  expect(await readImageTextureUploadCount(launched.window)).toBe(uploadsBeforeEdits);
});

async function openComposityToneCurveOnRedChannel(): Promise<void> {
  await openOperation(launched.window, TONE_CURVE_LABEL);
  await expectToneCurveOpensWithTwoEndpoints(launched.window);
  await selectToneCurveChannel(launched.window, "Red");
  await expectToneCurveOpensWithTwoEndpoints(launched.window);
}

// Pulling the active channel's right endpoint output to ~half halves that channel's
// rendered values, a strong but contained darkening (no pixel crosses the clear-color
// floor) so the other two channels' averages stay put.
async function darkenActiveChannelRightEndpointTo(output: number): Promise<void> {
  await toneCurveEndpointHandles(launched.window).last().click();
  await setToneCurveAnchorField(launched.window, "Output", output);
}

async function editGreenChannelToProveSuccessiveEditsAreLutOnly(): Promise<void> {
  await selectToneCurveChannel(launched.window, "Green");
  await expectToneCurveOpensWithTwoEndpoints(launched.window);
  await darkenActiveChannelRightEndpointTo(GREEN_RIGHT_ENDPOINT_HALF_OUTPUT);
}

async function expectRedComponentDroppedWhileGreenAndBlueHold(
  before: Awaited<ReturnType<typeof averageNonClearCanvasColor>>,
): Promise<void> {
  await expect
    .poll(() => averageNonClearCanvasColor(panelCanvas(launched.window, PANEL)).then((c) => c.red))
    .toBeLessThan(before.red - RED_DROP_FLOOR);
  const after = await averageNonClearCanvasColor(panelCanvas(launched.window, PANEL));
  expect(Math.abs(after.green - before.green)).toBeLessThan(OTHER_CHANNEL_TOLERANCE);
  expect(Math.abs(after.blue - before.blue)).toBeLessThan(OTHER_CHANNEL_TOLERANCE);
}

async function expectTopLeftRedReadoutEquals(expected: number): Promise<void> {
  await expectPixelReadoutToEqual(launched.window, {
    panel: PANEL,
    imageX: 0,
    imageY: 0,
    dimensions: RGB_DIMENSIONS,
    expected,
  });
}

async function settledAverageCanvasColor(): Promise<Awaited<ReturnType<typeof averageNonClearCanvasColor>>> {
  await launched.window.waitForTimeout(200);
  return averageNonClearCanvasColor(panelCanvas(launched.window, PANEL));
}
