import { expect, test } from "@playwright/test";

import { lowContrastGrayPng, multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import { loadFixtureAsStack, openOperation } from "./support/page-objects";
import { scopeFieldset, scopeOptionRadios } from "./support/cube-scope-control";

// CT-189: Full stack and Band-wise are identical for a one-band stack, so the "Scope"
// radio is a redundant choice there and must be hidden. On a multi-band stack it renders
// exactly as before. Normalize is the scope-bearing tool under test.

const NORMALIZE = "Normalize";

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("hides the scope selector for a single-band stack", async () => {
  await loadFixtureAsStack(launched.window, lowContrastGrayPng.fileName);
  await openOperation(launched.window, NORMALIZE);

  await expect(scopeFieldset(launched.window, NORMALIZE)).toHaveCount(0);
  await expect(scopeOptionRadios(launched.window, NORMALIZE)).toHaveCount(0);
});

test("shows the scope selector for a multi-band stack", async () => {
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await openOperation(launched.window, NORMALIZE);

  await expect(scopeFieldset(launched.window, NORMALIZE)).toBeVisible();
  await expect(scopeOptionRadios(launched.window, NORMALIZE)).toHaveCount(2);
});
