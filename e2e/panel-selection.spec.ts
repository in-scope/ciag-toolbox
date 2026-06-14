import { test, expect } from "@playwright/test";

import { lowContrastGrayPng } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applicationToolbar,
  clickGridBackgroundToClearSelection,
  clickPanelToSelect,
  countSelectedPanels,
  expectOnlyPanelsSelected,
  expectPanelShowsSelectionRing,
  loadFixtureAsStack,
  selectGridLayout,
} from "./support/page-objects";
import type { Locator } from "@playwright/test";

// Manual test script section 9 (CT-009): panel selection gestures (single click,
// ctrl/cmd toggle, shift range, background clear) and the apply affordance.
//
// Selection is a gridcell-level concern (aria-selected + the primary-blue ring),
// independent of panel content, so the gesture tests run on an EMPTY 2x3 grid and
// clickPanelToSelect clicks near the cell's top-left corner to avoid the centred
// empty-state button and the multi-band canvas pixel-pin handler.
//
// STALE-MANUAL (no E2E-BUG): manual 9.2 describes an "Apply to Selected" button with
// a numeric count - a Stage-1 affordance the Stage-3 app no longer has. The per-
// operation toolbar buttons are the apply affordance and enable only when EXACTLY
// one loaded panel is selected (deriveActionAvailabilityForActiveViewport gates on
// singleSelectedSource, null unless selectedIndices.size === 1 with content). So
// they disable at zero AND at 2+ selection, which is how the PRD AC ("reflects the
// selected count and disables at zero selection") maps onto the real app.

const OPERATION_APPLY_AFFORDANCE = "Bit Shift";

let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchToolboxApp();
  await selectGridLayout(launched.window, "2x3");
  // selectGridLayout returns focus to the Grid Layout trigger, whose tooltip then
  // instant-opens and overlays the top of panel 1; a background click blurs the
  // trigger (dismissing the tooltip) and leaves the selection empty.
  await clickGridBackgroundToClearSelection(launched.window);
});

test.afterAll(async () => {
  await closeToolboxApp(launched);
});

test("clicking a panel selects exactly it with a visible selection ring", async () => {
  await clickPanelToSelect(launched.window, 1);
  await expectPanelShowsSelectionRing(launched.window, 1);
  await expectOnlyPanelsSelected(launched.window, [1]);
});

test("ctrl/cmd-click toggles additional panels in and out of the selection", async () => {
  await clickPanelToSelect(launched.window, 1);
  await clickPanelToSelect(launched.window, 3, { ctrlOrMeta: true });
  await expectOnlyPanelsSelected(launched.window, [1, 3]);
  expect(await countSelectedPanels(launched.window)).toBe(2);
  await clickPanelToSelect(launched.window, 1, { ctrlOrMeta: true });
  await expectOnlyPanelsSelected(launched.window, [3]);
  expect(await countSelectedPanels(launched.window)).toBe(1);
});

test("shift-click selects a row-major range from the anchor", async () => {
  await clickPanelToSelect(launched.window, 2);
  await clickPanelToSelect(launched.window, 5, { shift: true });
  await expectOnlyPanelsSelected(launched.window, [2, 3, 4, 5]);
  expect(await countSelectedPanels(launched.window)).toBe(4);
});

test("clicking the background clears the selection", async () => {
  await clickPanelToSelect(launched.window, 2);
  expect(await countSelectedPanels(launched.window)).toBeGreaterThan(0);
  await clickGridBackgroundToClearSelection(launched.window);
  expect(await countSelectedPanels(launched.window)).toBe(0);
});

test("the apply affordance reflects the selected count and disables at zero selection", async () => {
  const app = await launchToolboxApp();
  try {
    await assertApplyAffordanceTracksSingleSelection(app);
  } finally {
    await closeToolboxApp(app);
  }
});

async function assertApplyAffordanceTracksSingleSelection(app: LaunchedApp): Promise<void> {
  await selectGridLayout(app.window, "1x2");
  const affordance = operationApplyAffordance(app);
  await expect(affordance).toBeDisabled();
  await loadFixtureAsStack(app.window, lowContrastGrayPng.fileName);
  await expect(affordance).toBeEnabled();
  await clickPanelToSelect(app.window, 2, { ctrlOrMeta: true });
  await expect(affordance).toBeDisabled();
  await clickGridBackgroundToClearSelection(app.window);
  await expect(affordance).toBeDisabled();
}

function operationApplyAffordance(app: LaunchedApp): Locator {
  // A disabled operation button appends a hint to its accessible name and drops it
  // once enabled, so match the stable label prefix rather than the exact name.
  return applicationToolbar(app.window).getByRole("button", {
    name: new RegExp(`^${OPERATION_APPLY_AFFORDANCE}`),
  });
}
