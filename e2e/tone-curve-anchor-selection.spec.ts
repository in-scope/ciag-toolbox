import { test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  addToneCurveAnchorAtFraction,
  clickToneCurveAnchorHandle,
  dragToneCurveEndpointTo,
  expectExactlyOneToneCurveAnchorSelected,
  expectToneCurveHandleIsSelected,
  expectToneCurveOpensWithTwoEndpoints,
  loadFixtureAsStack,
  openOperation,
  selectPanel,
  toneCurveEndpointHandles,
  toneCurveInteriorHandles,
  TONE_CURVE_LABEL,
} from "./support/page-objects";

// CT-164: the tone-curve editor tracks a SINGLE selected anchor at a time, exposed via the
// stable data-selected="true" attribute on the handle, so the CT-165 numeric fields and the
// CT-166 keyboard actions always have one target. On mount the left endpoint is selected;
// clicking, adding, and dragging each move the selection to the touched anchor and leave
// exactly one anchor selected.

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

test("selects the left endpoint by default on mount", async () => {
  await expectExactlyOneToneCurveAnchorSelected(launched.window);
  await expectToneCurveHandleIsSelected(toneCurveEndpointHandles(launched.window).first());
});

test("clicking an existing anchor makes it the single selected anchor", async () => {
  await clickToneCurveAnchorHandle(toneCurveEndpointHandles(launched.window).last());
  await expectExactlyOneToneCurveAnchorSelected(launched.window);
  await expectToneCurveHandleIsSelected(toneCurveEndpointHandles(launched.window).last());
});

test("adding an anchor by clicking the background selects the new anchor", async () => {
  await addToneCurveAnchorAtFraction(launched.window, 0.5, 0.5);
  await expectExactlyOneToneCurveAnchorSelected(launched.window);
  await expectToneCurveHandleIsSelected(toneCurveInteriorHandles(launched.window).first());
});

test("dragging an anchor selects it and it stays selected after the drag", async () => {
  await clickToneCurveAnchorHandle(toneCurveEndpointHandles(launched.window).last());
  await dragToneCurveEndpointTo(launched.window, "left", -0.2, -0.2);
  await expectExactlyOneToneCurveAnchorSelected(launched.window);
  await expectToneCurveHandleIsSelected(toneCurveEndpointHandles(launched.window).first());
});
