import { expect, test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  addToneCurveAnchorAtFraction,
  clickToneCurveResetToIdentity,
  expectExactlyOneToneCurveAnchorSelected,
  expectToneCurveHandleIsSelected,
  expectToneCurveOpensWithTwoEndpoints,
  historyEntryCount,
  loadFixtureAsStack,
  nonClearPixelFraction,
  openOperation,
  panelCanvas,
  selectPanel,
  summarizeCanvasPixels,
  toneCurveEndpointHandles,
  toneCurveInteriorHandles,
  toneCurveResetButton,
  TONE_CURVE_LABEL,
} from "./support/page-objects";

// CT-167: a Reset control returns the tone curve to the straight identity diagonal without
// closing the panel (GIMP "Reset Channel"). Reset only reshapes the curve (and live preview) -
// it never applies the operation or records History. Idempotency is made observable by disabling
// Reset while the curve already equals identity. multiband-12bit.tif is an integer uint16 band
// whose default identity curve renders near-black; a low-input/high-output anchor brightens the
// live preview, and Reset drops it back to the identity (near-black) render.

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

test("Reset is disabled at identity and enables once the curve is edited", async () => {
  await expect(toneCurveResetButton(launched.window)).toBeDisabled();
  await addToneCurveAnchorAtFraction(launched.window, 0.5, 0.5);
  await expect(toneCurveResetButton(launched.window)).toBeEnabled();
});

test("Reset returns the curve to two identity endpoints, selects the left endpoint, and re-disables", async () => {
  await addToneCurveAnchorAtFraction(launched.window, 0.4, 0.3);
  await addToneCurveAnchorAtFraction(launched.window, 0.7, 0.8);
  await clickToneCurveResetToIdentity(launched.window);
  await expectToneCurveOpensWithTwoEndpoints(launched.window);
  await expectExactlyOneToneCurveAnchorSelected(launched.window);
  await expectToneCurveHandleIsSelected(toneCurveEndpointHandles(launched.window).first());
  await expect(toneCurveResetButton(launched.window)).toBeDisabled();
});

test("Reset alone applies nothing and records no History entry", async () => {
  await addToneCurveAnchorAtFraction(launched.window, 0.5, 0.5);
  await clickToneCurveResetToIdentity(launched.window);
  expect(await historyEntryCount(launched.window)).toBe(0);
});

test("Reset restores the identity live preview", async () => {
  await expectPanelPreviewFractionBelow(NEAR_BLACK_PREVIEW_FRACTION);
  await addToneCurveAnchorAtFraction(launched.window, 0.01, 0);
  await expectPanelPreviewFractionAbove(BRIGHT_PREVIEW_FRACTION);
  await clickToneCurveResetToIdentity(launched.window);
  await expect(toneCurveInteriorHandles(launched.window)).toHaveCount(0);
  await expectPanelPreviewFractionBelow(NEAR_BLACK_PREVIEW_FRACTION);
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
