import { test, expect } from "@playwright/test";
import { basename } from "node:path";

import { writeTemporaryGrayscalePngFixture } from "./support/create-temporary-png-fixture";
import { enqueueOpenDialogPaths } from "./support/dialog-stub-controls";
import { launchToolboxApp, closeToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";

let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchToolboxApp();
});

test.afterAll(async () => {
  await closeToolboxApp(launched);
});

test("loads a fixture through the dialog stub into a panel", async () => {
  const fixturePath = await writeTemporaryGrayscalePngFixture();
  await enqueueOpenDialogPaths(launched.window, [fixturePath]);
  await clickOpenImageToolbarButton();
  await expect(panelLabelFor(fixturePath)).toBeVisible();
});

async function clickOpenImageToolbarButton(): Promise<void> {
  const toolbar = launched.window.getByRole("toolbar", { name: "Application toolbar" });
  await toolbar.getByRole("button", { name: "Open image" }).click();
}

function panelLabelFor(fixturePath: string) {
  return launched.window.getByText(basename(fixturePath), { exact: true });
}
