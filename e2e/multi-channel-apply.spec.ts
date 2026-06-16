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

// CT-178: Apply on a true-colour composite bakes every channel in ONE operation,
// folding the rgb/Value curve over each channel's own curve. This deliverable sets a
// RED-ONLY curve on rgb.png ((0,0)=(200,100,50)) that halves Red, Applies, and proves the
// bake is per-channel: the RED data value at (0,0) drops from 200 to 100 via the
// pixel-readout oracle, while GREEN and BLUE hold. The composite hides the band navigator,
// so the status bar only exposes the selected (Red) band's value - GREEN/BLUE are verified
// by sampling the rendered canvas (averageNonClearCanvasColor, the same per-channel oracle
// CT-177 used), which after Apply reflects the baked band data. Halving (not flattening to
// black) keeps every pixel above the clear-colour floor so the green/blue averages are
// measured over the same pixel population before and after. Exactly one History entry.

const PANEL = 1;
const RGB_DIMENSIONS: PixelDimensions = { width: rgbPng.width, height: rgbPng.height };
const TOP_LEFT_RED_BEFORE = 200;
const RED_RIGHT_ENDPOINT_HALF_OUTPUT = 128;
// out = in * 128/255; the 2-anchor curve is exactly linear, so 200 -> round(100.39) = 100.
const TOP_LEFT_RED_AFTER = 100;
const RED_DROP_FLOOR = 20;
const OTHER_CHANNEL_TOLERANCE = 12;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, rgbPng.fileName);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("Apply bakes a red-only curve on a composite: red changes, green and blue hold, one History entry", async () => {
  const before = await settledAverageCanvasColor();
  await expectTopLeftRedReadoutEquals(TOP_LEFT_RED_BEFORE);
  await setRedOnlyCurveHalvingRed();
  await applyOperationInPlace(launched.window, TONE_CURVE_LABEL);
  await expectTopLeftRedReadoutEquals(TOP_LEFT_RED_AFTER);
  await expectRedComponentDroppedWhileGreenAndBlueHold(before);
  await expectExactlyOneRedChannelHistoryEntry();
});

async function setRedOnlyCurveHalvingRed(): Promise<void> {
  await openOperation(launched.window, TONE_CURVE_LABEL);
  await expectToneCurveOpensWithTwoEndpoints(launched.window);
  await selectToneCurveChannel(launched.window, "Red");
  await expectToneCurveOpensWithTwoEndpoints(launched.window);
  await toneCurveEndpointHandles(launched.window).last().click();
  await setToneCurveAnchorField(launched.window, "Output", RED_RIGHT_ENDPOINT_HALF_OUTPUT);
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

async function expectExactlyOneRedChannelHistoryEntry(): Promise<void> {
  expect(await historyEntryCount(launched.window)).toBe(1);
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: TONE_CURVE_LABEL,
    detailSubstrings: ["channels: Red"],
  });
}

async function settledAverageCanvasColor(): Promise<Awaited<ReturnType<typeof averageNonClearCanvasColor>>> {
  await launched.window.waitForTimeout(200);
  return averageNonClearCanvasColor(panelCanvas(launched.window, PANEL));
}
