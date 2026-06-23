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

// CT-187: a band-wise tool must DOCUMENT the accepted band-selection syntax (comma lists
// and dash ranges, never colons) as visible help text, not only as an input placeholder.
// Normalize is the band-wise tool under test; the hint text lives next to the "Bands to
// process" range input the moment the Band-wise scope is chosen.

const NORMALIZE = "Normalize";
const ANY_VALID_RANGE = "1-3";

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("Band-wise scope documents the comma-and-dash syntax as visible help text", async () => {
  await openOperation(launched.window, NORMALIZE);
  await selectBandWiseScopeForBands(launched.window, NORMALIZE, ANY_VALID_RANGE);

  const panel = operationPanel(launched.window, NORMALIZE);
  await expect(panel.getByText(/ranges use dashes, not colons/i)).toBeVisible();
  await expect(panel.getByText(/1,3,5 or 1-5,10/)).toBeVisible();
});
