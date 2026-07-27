import { test, expect } from "@playwright/test";
import type { Locator } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applicationToolbar,
  loadFixtureAsStack,
  selectPanel,
} from "./support/page-objects";

// Manual test script section 4 (CT-004): the toolbar strip, its controls,
// accessible names, and the disabled-until-a-panel-is-loaded affordance.

const OPERATION_APPLY_AFFORDANCE = "Contrast Curve";
const FRESHLY_LOADED_PANEL = 1;

// The toolbar rule (operation-menu-catalog.ts): mode toggles, zero-parameter
// one-click applies, and the everyday panel-openers. Everything else is
// menu-only, so this is the EXACT expected button set, in order.
const EXPECTED_TOOLBAR_BUTTON_LABELS = [
  "Open image",
  "Grid layout",
  "Select Region",
  "Subset Bands",
  "Crop to Region",
  "Rotate 90° clockwise",
  "Rotate 90° counterclockwise",
  "Reflect horizontally",
  "Reflect vertically",
  "Contrast Curve",
  "Brightness & Contrast",
];

let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchToolboxApp();
});

test.afterAll(async () => {
  await closeToolboxApp(launched);
});

test("the toolbar strip spans the window and is exposed as a toolbar", async () => {
  await expect(applicationToolbar(launched.window)).toBeVisible();
});

test("exposes the Open Images, Grid Layout, and operation-apply controls", async () => {
  await expect(openImagesControl(launched)).toBeVisible();
  await expect(gridLayoutDropdown(launched)).toBeVisible();
  await expect(operationApplyAffordance(launched)).toBeVisible();
});

test("the toolbar carries exactly the shortcut allowlist, in order", async () => {
  const names = await readToolbarButtonBaseNames(launched);
  expect(names).toEqual(EXPECTED_TOOLBAR_BUTTON_LABELS);
});

test("every toolbar button exposes an accessible name", async () => {
  const allButtons = applicationToolbar(launched.window).getByRole("button");
  const namedButtons = applicationToolbar(launched.window).getByRole("button", {
    name: /\S/,
  });
  expect(await namedButtons.count()).toBe(await allButtons.count());
});

test("operation-apply controls disable on a fresh launch and enable once a panel loads", async () => {
  const fresh = await launchToolboxApp();
  try {
    await expect(operationApplyAffordance(fresh)).toBeDisabled();
    await loadFixtureAsStack(fresh.window, multiBandTiff.fileName);
    await selectPanel(fresh.window, FRESHLY_LOADED_PANEL);
    await expect(operationApplyAffordance(fresh)).toBeEnabled();
  } finally {
    await closeToolboxApp(fresh);
  }
});

async function readToolbarButtonBaseNames(app: LaunchedApp): Promise<string[]> {
  const buttons = applicationToolbar(app.window).getByRole("button");
  const accessibleNames = await buttons.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("aria-label") ?? ""),
  );
  // Accessible names carry state suffixes ("Grid layout (currently 2x2)",
  // "Contrast Curve (select a panel with a loaded stack)"); compare the stable prefix.
  return accessibleNames.map((name) => name.replace(/ \(.*\)$/, ""));
}

function openImagesControl(app: LaunchedApp): Locator {
  return applicationToolbar(app.window).getByRole("button", { name: "Open image" });
}

function gridLayoutDropdown(app: LaunchedApp): Locator {
  return applicationToolbar(app.window).getByRole("button", { name: "Grid layout" });
}

function operationApplyAffordance(app: LaunchedApp): Locator {
  // A disabled operation button appends a hint to its accessible name (e.g.
  // "Bit Shift (select a panel with a loaded stack)") and drops it once enabled,
  // so match the stable label prefix rather than the exact name.
  return applicationToolbar(app.window).getByRole("button", {
    name: new RegExp(`^${OPERATION_APPLY_AFFORDANCE}`),
  });
}
