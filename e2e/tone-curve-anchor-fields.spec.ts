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

// CT-165: the selected tone-curve anchor exposes numeric Input/Output fields with +/- steppers,
// so points can be placed precisely instead of only by dragging. multiband-12bit.tif is an
// integer uint16 band (step 1, input/output axis 0..65535), so the fields show integers. The
// numeric edits share the drag path's clamping helper: endpoints keep a fixed Input, interior
// anchors cannot cross their neighbours, and Output is clamped to the band's output range.

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

test("selecting an anchor populates the Input/Output fields, with a fixed Input on endpoints", async () => {
  expect(await readToneCurveAnchorFieldValue(launched.window, "Input")).toBe("0");
  expect(await readToneCurveAnchorFieldValue(launched.window, "Output")).toBe("0");
  await expect(toneCurveAnchorField(launched.window, "Input")).toBeDisabled();
  await clickToneCurveAnchorHandle(toneCurveEndpointHandles(launched.window).last());
  expect(await readToneCurveAnchorFieldValue(launched.window, "Input")).toBe(String(UINT16_TYPE_MAX));
  expect(await readToneCurveAnchorFieldValue(launched.window, "Output")).toBe(String(UINT16_TYPE_MAX));
});

test("typing an Output value moves the anchor and changes the applied pixel values", async () => {
  await setToneCurveAnchorField(launched.window, "Output", UINT16_TYPE_MAX);
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
  expect(await readToneCurveAnchorFieldValue(launched.window, "Output")).toBe("0");
  await stepToneCurveAnchorField(launched.window, "Output", "increase");
  expect(await readToneCurveAnchorFieldValue(launched.window, "Output")).toBe("1");
});

test("typing an Input past a neighbour is clamped so anchors stay strictly increasing", async () => {
  await addToneCurveAnchorAtFraction(launched.window, 0.5, 0.5);
  await setToneCurveAnchorField(launched.window, "Input", 999999);
  const clampedInput = Number(await readToneCurveAnchorFieldValue(launched.window, "Input"));
  expect(clampedInput).toBeGreaterThan(0);
  expect(clampedInput).toBeLessThan(UINT16_TYPE_MAX);
});
