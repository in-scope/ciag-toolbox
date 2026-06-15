import { test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  addToneCurveAnchorAtFraction,
  expectToneCurveOpensWithTwoEndpoints,
  expectToneCurveReferenceGridIsPresent,
  loadFixtureAsStack,
  openOperation,
  selectPanel,
  toneCurveInteriorHandles,
  TONE_CURVE_LABEL,
} from "./support/page-objects";

// CT-168: the tone-curve editor draws a decorative 8x8 reference grid behind the curve so
// anchor positions can be judged against eighths of the input/output range. The grid is
// pointer-events-none, so clicking on it still adds/selects an anchor as before.

const PANEL = 1;

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

test("renders the reference grid behind the curve", async () => {
  await expectToneCurveReferenceGridIsPresent(launched.window);
});

test("clicking the editor still adds an anchor with the grid drawn", async () => {
  await expectToneCurveReferenceGridIsPresent(launched.window);
  await addToneCurveAnchorAtFraction(launched.window, 0.5, 0.5);
  await test.expect(toneCurveInteriorHandles(launched.window)).toHaveCount(1);
});
