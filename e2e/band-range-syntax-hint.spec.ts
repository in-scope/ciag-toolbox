import { expect, test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  loadFixtureAsStack,
  openOperation,
  operationPanel,
  selectBandWiseScopeForBands,
} from "./support/page-objects";

// CT-287 (supersedes CT-187): every band-wise scope field shows ONE shared help
// sentence covering the comma-and-dash syntax plus the empty-field behavior, and
// nothing else - the per-tool scope explanations and the separate "ranges use
// dashes, not colons" hint are gone. Two of the five panels are asserted here.

const SHARED_SCOPE_DESCRIPTION =
  "Use commas to list bands and dashes for ranges (e.g. 1,3,5 or 1-5,10); empty field processes every band.";
const NORMALIZE = "Normalize";
const FREQUENCY_FILTERS = "Frequency Filters";
const ANY_VALID_RANGE = "1-3";

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("Normalize shows exactly the shared band-scope description", async () => {
  await openOperation(launched.window, NORMALIZE);
  await selectBandWiseScopeForBands(launched.window, NORMALIZE, ANY_VALID_RANGE);

  const panel = operationPanel(launched.window, NORMALIZE);
  await expect(panel.getByText(SHARED_SCOPE_DESCRIPTION, { exact: true })).toBeVisible();
  await expect(panel.getByText(/Leave the band field empty/i)).toBeHidden();
  await expect(panel.getByText(/ranges use dashes, not colons/i)).toBeHidden();
});

test("Frequency Filters shows exactly the shared band-scope description", async () => {
  await openOperation(launched.window, FREQUENCY_FILTERS);

  const panel = operationPanel(launched.window, FREQUENCY_FILTERS);
  await expect(panel.getByText(SHARED_SCOPE_DESCRIPTION, { exact: true })).toBeVisible();
  await expect(panel.getByText(/Leave the band field empty/i)).toBeHidden();
});
