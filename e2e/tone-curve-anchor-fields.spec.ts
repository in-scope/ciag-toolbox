import { expect, test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import type { PixelDimensions } from "./support/page-objects";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  addToneCurveAnchorAtFraction,
  applyOperationInPlace,
  clickToneCurveAnchorHandle,
  expectPixelReadoutToEqual,
  expectToneCurveOpensWithTwoEndpoints,
  loadFixtureAsStack,
  openOperation,
  readToneCurveAnchorFieldValue,
  selectPanel,
  setToneCurveAnchorField,
  stepToneCurveAnchorField,
  toneCurveAnchorField,
  toneCurveEndpointHandles,
  TONE_CURVE_LABEL,
} from "./support/page-objects";

// CT-165: the selected contrast-curve anchor exposes numeric fields with +/- steppers, so
// points can be placed precisely instead of only by dragging. CT-246 relabelled them
// "Original value" (the anchor input) and "New value" (the anchor output). multiband-12bit.tif
// is an integer uint16 band (step 1, input/output axis 0..65535), so the fields show integers.
// The numeric edits share the drag path's clamping helper: an endpoint's Original value moves
// inward between the data-range edge and its neighbour (CT-199 black/white point), interior
// anchors cannot cross their neighbours, and the New value is clamped to the band's output range.

const PANEL = 1;
const UINT16_TYPE_MAX = 65535;
const FOUR_BY_FOUR: PixelDimensions = { width: multiBandTiff.width, height: multiBandTiff.height };

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

test("selecting an anchor populates the Original/New value fields, with an editable Original value on endpoints", async () => {
  expect(await readToneCurveAnchorFieldValue(launched.window, "Original value")).toBe("0");
  expect(await readToneCurveAnchorFieldValue(launched.window, "New value")).toBe("0");
  await expect(toneCurveAnchorField(launched.window, "Original value")).not.toBeDisabled();
  await clickToneCurveAnchorHandle(toneCurveEndpointHandles(launched.window).last());
  expect(await readToneCurveAnchorFieldValue(launched.window, "Original value")).toBe(String(UINT16_TYPE_MAX));
  expect(await readToneCurveAnchorFieldValue(launched.window, "New value")).toBe(String(UINT16_TYPE_MAX));
});

test("typing a New value moves the anchor and changes the applied pixel values", async () => {
  await setToneCurveAnchorField(launched.window, "New value", UINT16_TYPE_MAX);
  await applyOperationInPlace(launched.window, TONE_CURVE_LABEL);
  await expectPixelReadoutToEqual(launched.window, {
    panel: PANEL,
    imageX: 0,
    imageY: 0,
    dimensions: FOUR_BY_FOUR,
    expected: UINT16_TYPE_MAX,
  });
});

test("a stepper changes the selected anchor's value by the data-type step (1 for integer bands)", async () => {
  expect(await readToneCurveAnchorFieldValue(launched.window, "New value")).toBe("0");
  await stepToneCurveAnchorField(launched.window, "New value", "increase");
  expect(await readToneCurveAnchorFieldValue(launched.window, "New value")).toBe("1");
});

test("typing an Original value past a neighbour is clamped so anchors stay strictly increasing", async () => {
  await addToneCurveAnchorAtFraction(launched.window, 0.5, 0.5);
  await setToneCurveAnchorField(launched.window, "Original value", 999999);
  const clampedInput = Number(await readToneCurveAnchorFieldValue(launched.window, "Original value"));
  expect(clampedInput).toBeGreaterThan(0);
  expect(clampedInput).toBeLessThan(UINT16_TYPE_MAX);
});
