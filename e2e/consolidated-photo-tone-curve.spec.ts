import { expect, test } from "@playwright/test";

import { rgbPng } from "./fixtures/fixture-manifest";
import type { PixelDimensions } from "./support/page-objects";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperationInPlace,
  averageNonClearCanvasColor,
  expectHistoryToRecordOperation,
  expectPixelReadoutToEqual,
  expectToneCurveOpensWithTwoEndpoints,
  historyEntryCount,
  loadFixtureAsStack,
  openOperation,
  panelCanvas,
  selectToneCurveChannel,
  setToneCurveAnchorField,
  toneCurveEndpointHandles,
  TONE_CURVE_LABEL,
} from "./support/page-objects";
import type { ToneCurveChannelButtonName } from "./support/tone-curve-editor";

// CT-179: ONE consolidated regression for the GIMP-parity tone-curve + colour work. It
// drives a realistic photo edit end to end on rgb.png ((0,0)=(200,100,50)): the photographer
// halves the combined RGB/Value curve AND halves the Red channel's own curve, previews the
// result (display-only), then bakes it. Per-feature coverage already lives in CT-171/172/176/
// 177/178; this only re-exercises the whole chain together.
//
// The Apply oracle pins the compose contract composed(v) = valueCurve(channelCurve(v)): a
// red-only halve would leave (0,0) Red at 100, a value-only halve would also leave it at 100,
// but BOTH folded together give round(200 * 128/255 * 128/255) = 50. So the single number 50
// proves both edits committed in one operation, and the History entry names both channels.

const PANEL = 1;
const RGB_DIMENSIONS: PixelDimensions = { width: rgbPng.width, height: rgbPng.height };
const TOP_LEFT_RED_BEFORE = 200;
const RIGHT_ENDPOINT_HALF_OUTPUT = 128;
// composed(200) = value(red(200)) = round(200 * 128/255 * 128/255) = round(50.39) = 50.
const TOP_LEFT_RED_AFTER = 50;
const PREVIEW_RED_DROP_FLOOR = 20;
const PREVIEW_GREEN_DROP_FLOOR = 15;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, rgbPng.fileName);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("a photo edit of the RGB/Value curve plus a Red-channel tweak previews display-only then bakes both in one operation", async () => {
  await openOperation(launched.window, TONE_CURVE_LABEL);
  await expectToneCurveOpensWithTwoEndpoints(launched.window);
  const beforePreview = await settledAverageCanvasColor();
  await halveActiveChannelRightEndpoint("RGB");
  await halveActiveChannelRightEndpoint("Red");
  await expectPreviewDarkenedTheRenderedPhoto(beforePreview);
  await expectTopLeftRedReadoutEquals(TOP_LEFT_RED_BEFORE);
  expect(await historyEntryCount(launched.window)).toBe(0);
  await applyOperationInPlace(launched.window, TONE_CURVE_LABEL);
  await expectTopLeftRedReadoutEquals(TOP_LEFT_RED_AFTER);
  await expectExactlyOneHistoryEntryNamingBothChannels();
});

async function halveActiveChannelRightEndpoint(channel: ToneCurveChannelButtonName): Promise<void> {
  await selectToneCurveChannel(launched.window, channel);
  await expectToneCurveOpensWithTwoEndpoints(launched.window);
  await toneCurveEndpointHandles(launched.window).last().click();
  await setToneCurveAnchorField(launched.window, "Output", RIGHT_ENDPOINT_HALF_OUTPUT);
}

// Display-only proof: both curves halve, so the rendered photo darkens across channels while
// the underlying data is untouched (the readout + History checks that follow).
async function expectPreviewDarkenedTheRenderedPhoto(
  before: Awaited<ReturnType<typeof averageNonClearCanvasColor>>,
): Promise<void> {
  await expect
    .poll(() => averageNonClearCanvasColor(panelCanvas(launched.window, PANEL)).then((c) => c.red))
    .toBeLessThan(before.red - PREVIEW_RED_DROP_FLOOR);
  const after = await averageNonClearCanvasColor(panelCanvas(launched.window, PANEL));
  expect(after.green).toBeLessThan(before.green - PREVIEW_GREEN_DROP_FLOOR);
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

async function expectExactlyOneHistoryEntryNamingBothChannels(): Promise<void> {
  expect(await historyEntryCount(launched.window)).toBe(1);
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: TONE_CURVE_LABEL,
    detailSubstrings: ["channels: RGB, Red"],
  });
}

async function settledAverageCanvasColor(): Promise<Awaited<ReturnType<typeof averageNonClearCanvasColor>>> {
  await launched.window.waitForTimeout(200);
  return averageNonClearCanvasColor(panelCanvas(launched.window, PANEL));
}
