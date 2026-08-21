import { expect, test } from "@playwright/test";
import type { Locator } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  loadFixtureAsStack,
  openOperation,
  openSubsetBandsEditor,
  selectPanel,
  setOpenInNewPanel,
} from "./support/page-objects";
import { runAsStoryboardStep } from "./support/storyboard-step";

// CT-277: every "Open in a new panel" switch names its off state with one line
// of helper text beneath it, visible whether the switch is on or off. Both
// rendering sites share one component: the tool-options panel footer and the
// Subset Bands editor.

const PANEL = 1;
const INVERT = "Invert";
const OFF_STATE_HINT = "Off: replaces the current panel.";

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, PANEL);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("the tool-options panel toggle shows the off-state hint in both states", async () => {
  const panel = await openOperation(launched.window, INVERT);
  await expectOffStateHintWithin(panel, "The hint shows while the switch is on (default)");
  await setOpenInNewPanel(launched.window, INVERT, false);
  await expectOffStateHintWithin(panel, "The hint stays while the switch is off");
});

test("the Subset Bands editor toggle shows the off-state hint", async () => {
  const editor = await openSubsetBandsEditor(launched.window);
  await expectOffStateHintWithin(editor, "The Subset Bands editor shows the hint");
});

async function expectOffStateHintWithin(container: Locator, stepTitle: string): Promise<void> {
  await runAsStoryboardStep(launched.window, stepTitle, async () => {
    await expect(container.getByText(OFF_STATE_HINT, { exact: true })).toBeVisible();
  });
}
