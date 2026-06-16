import { expect, test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  addToneCurveAnchorAtFraction,
  clickToneCurveAnchorHandle,
  deleteSelectedToneCurveAnchor,
  expectToneCurveOpensWithTwoEndpoints,
  loadFixtureAsStack,
  nonClearPixelFraction,
  nudgeSelectedToneCurveAnchor,
  openOperation,
  panelCanvas,
  readToneCurveAnchorFieldValue,
  selectPanel,
  summarizeCanvasPixels,
  toneCurveEndpointHandles,
  toneCurveInteriorHandles,
  TONE_CURVE_LABEL,
} from "./support/page-objects";

// CT-166: keyboard nudge + delete for the selected tone-curve anchor (GIMP Curves parity).
// With an anchor selected and the editor focused, ArrowLeft/Right change its Input by one step
// and ArrowUp/Down change its Output by one step (same clamping as the CT-165 fields); Delete
// removes the selected interior anchor (an endpoint Delete is a no-op). multiband-12bit.tif is
// an integer uint16 band so the step is 1; the numeric fields read the moved anchor back, and
// the panel's live tone-curve preview reflects the curve immediately (a removed brightening
// anchor drops the near-black band back to black).

const PANEL = 1;
const NEAR_BLACK_PREVIEW_FRACTION = 0.05;
const BRIGHT_PREVIEW_FRACTION = 0.2;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, PANEL);
  await openOperation(launched.window, TONE_CURVE_LABEL);
  await expectToneCurveOpensWithTwoEndpoints(launched.window);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("arrow keys nudge the selected anchor's Input and Output by one step", async () => {
  await addToneCurveAnchorAtFraction(launched.window, 0.4, 0.5);
  await clickToneCurveAnchorHandle(toneCurveInteriorHandles(launched.window).first());
  const inputBefore = Number(await readToneCurveAnchorFieldValue(launched.window, "Input"));
  const outputBefore = Number(await readToneCurveAnchorFieldValue(launched.window, "Output"));
  await nudgeSelectedToneCurveAnchor(launched.window, "right");
  await nudgeSelectedToneCurveAnchor(launched.window, "up");
  expect(Number(await readToneCurveAnchorFieldValue(launched.window, "Input"))).toBe(inputBefore + 1);
  expect(Number(await readToneCurveAnchorFieldValue(launched.window, "Output"))).toBe(outputBefore + 1);
});

test("left/down nudges move the selected anchor the opposite way", async () => {
  await addToneCurveAnchorAtFraction(launched.window, 0.4, 0.5);
  await clickToneCurveAnchorHandle(toneCurveInteriorHandles(launched.window).first());
  const inputBefore = Number(await readToneCurveAnchorFieldValue(launched.window, "Input"));
  const outputBefore = Number(await readToneCurveAnchorFieldValue(launched.window, "Output"));
  await nudgeSelectedToneCurveAnchor(launched.window, "left");
  await nudgeSelectedToneCurveAnchor(launched.window, "down");
  expect(Number(await readToneCurveAnchorFieldValue(launched.window, "Input"))).toBe(inputBefore - 1);
  expect(Number(await readToneCurveAnchorFieldValue(launched.window, "Output"))).toBe(outputBefore - 1);
});

test("Delete removes the selected interior anchor and updates the live preview", async () => {
  await expectPanelPreviewFractionBelow(NEAR_BLACK_PREVIEW_FRACTION);
  await addToneCurveAnchorAtFraction(launched.window, 0.01, 0);
  await expectPanelPreviewFractionAbove(BRIGHT_PREVIEW_FRACTION);
  await clickToneCurveAnchorHandle(toneCurveInteriorHandles(launched.window).first());
  await deleteSelectedToneCurveAnchor(launched.window);
  await expect(toneCurveInteriorHandles(launched.window)).toHaveCount(0);
  await expectPanelPreviewFractionBelow(NEAR_BLACK_PREVIEW_FRACTION);
});

test("Delete on an endpoint is a no-op (endpoints cannot be removed)", async () => {
  await clickToneCurveAnchorHandle(toneCurveEndpointHandles(launched.window).first());
  await deleteSelectedToneCurveAnchor(launched.window);
  await expect(toneCurveEndpointHandles(launched.window)).toHaveCount(2);
  await expect(toneCurveInteriorHandles(launched.window)).toHaveCount(0);
});

async function expectPanelPreviewFractionAbove(threshold: number): Promise<void> {
  await expect
    .poll(async () => nonClearPixelFraction(await summarizeCanvasPixels(panelCanvas(launched.window, PANEL))))
    .toBeGreaterThan(threshold);
}

async function expectPanelPreviewFractionBelow(threshold: number): Promise<void> {
  await expect
    .poll(async () => nonClearPixelFraction(await summarizeCanvasPixels(panelCanvas(launched.window, PANEL))))
    .toBeLessThan(threshold);
}
