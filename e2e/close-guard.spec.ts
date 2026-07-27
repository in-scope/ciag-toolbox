import { expect, test } from "@playwright/test";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";

import { rgbPng } from "./fixtures/fixture-manifest";
import {
  closeToolboxApp,
  launchToolboxApp,
  saveTraceBeforeExpectedAppExit,
  type LaunchedApp,
} from "./support/launch-app";
import { triggerMainWindowClose } from "./support/main-process";
import { enqueueSaveDialogPath } from "./support/dialog-stub-controls";
import { loadFixtureAsStack } from "./support/load-fixture";
import { readPixelValueAt, type PixelDimensions } from "./support/page-objects";
import { createTemporaryProjectBundleDirectory, openProjectBundleThroughOpenDialog } from "./support/project-bundle-flow";

// CT-258: closing the window with unsaved work asks first. Main intercepts the
// real window close event and the renderer answers: a clean or empty session
// closes immediately with no dialog, a dirty one shows the save-before-close
// AlertDialog whose three choices are covered here. "Save and close" writes
// the bundle through the save-dialog stub and then exits; reopening that
// bundle resets the saved revision, so the next close is clean again.

const PANEL = 1;
const RGB_DIMENSIONS: PixelDimensions = { width: rgbPng.width, height: rgbPng.height };
const RGB_TOP_LEFT_RED_VALUE = "200";

const DIALOG_TITLE = "Save this project before closing?";
const DIALOG_DESCRIPTION = "Unsaved changes will be lost.";

test("a fresh empty app closes with no save dialog", async () => {
  const launched = await launchToolboxApp();
  await test.step("wait for the app shell so the close guard is listening", async () => {
    await expect(
      launched.window.getByRole("toolbar", { name: "Application toolbar" }),
    ).toBeVisible();
  });
  await saveTraceBeforeExpectedAppExit(launched);
  await test.step("trigger the window close and expect the app to exit", async () => {
    await closeMainWindowAndAwaitAppExit(launched);
  });
});

test("closing with unsaved work shows the dialog; Cancel and Esc keep the app alive", async () => {
  const launched = await launchToolboxApp();
  try {
    await loadFixtureAsStack(launched.window, rgbPng.fileName);
    await test.step("trigger the window close and read the dialog copy", async () => {
      await triggerMainWindowClose(launched.app);
      const dialog = saveBeforeCloseDialog(launched.window);
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(DIALOG_DESCRIPTION);
    });
    await test.step("Cancel dismisses the dialog and the panel is intact", async () => {
      await saveBeforeCloseDialog(launched.window).getByRole("button", { name: "Cancel" }).click();
      await expect(saveBeforeCloseDialog(launched.window)).toHaveCount(0);
      await expectRgbPanelStillReadsItsPixels(launched.window);
    });
    await test.step("Esc dismisses a re-opened dialog the same way", async () => {
      await triggerMainWindowClose(launched.app);
      await expect(saveBeforeCloseDialog(launched.window)).toBeVisible();
      await launched.window.keyboard.press("Escape");
      await expect(saveBeforeCloseDialog(launched.window)).toHaveCount(0);
      await expectRgbPanelStillReadsItsPixels(launched.window);
    });
  } finally {
    await closeToolboxApp(launched);
  }
});

test("'Close without saving' exits the app immediately", async () => {
  const launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, rgbPng.fileName);
  await saveTraceBeforeExpectedAppExit(launched);
  await test.step("trigger the close and discard the session", async () => {
    const exited = waitForAppToExit(launched);
    await triggerMainWindowClose(launched.app);
    await saveBeforeCloseDialog(launched.window)
      .getByRole("button", { name: "Close without saving" })
      .click();
    await exited;
  });
});

test("'Save and close' writes the bundle and a reopened bundle closes clean", async () => {
  const bundlePath = join(await createTemporaryProjectBundleDirectory(), "close-guard.ctbundle");
  await saveAndCloseWritesTheBundleThenExits(bundlePath);
  await test.step("assert the bundle landed on disk", async () => {
    expect(existsSync(bundlePath)).toBe(true);
    expect(statSync(bundlePath).size).toBeGreaterThan(0);
  });
  await reopeningTheBundleClosesWithNoDialog(bundlePath);
});

async function saveAndCloseWritesTheBundleThenExits(bundlePath: string): Promise<void> {
  const launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, rgbPng.fileName);
  await enqueueSaveDialogPath(launched.window, bundlePath);
  await saveTraceBeforeExpectedAppExit(launched);
  await test.step("trigger the close and choose Save and close", async () => {
    const exited = waitForAppToExit(launched);
    await triggerMainWindowClose(launched.app);
    await saveBeforeCloseDialog(launched.window)
      .getByRole("button", { name: "Save and close" })
      .click();
    await exited;
  });
}

// Opening a project records the opened content as the saved revision, so a
// close right after a reopen must exit without asking.
async function reopeningTheBundleClosesWithNoDialog(bundlePath: string): Promise<void> {
  const launched = await launchToolboxApp();
  await openProjectBundleThroughOpenDialog({
    app: launched.app,
    page: launched.window,
    bundlePath,
  });
  await saveTraceBeforeExpectedAppExit(launched);
  await test.step("close the reopened session and expect a dialog-free exit", async () => {
    await closeMainWindowAndAwaitAppExit(launched);
  });
}

function saveBeforeCloseDialog(window: Page): Locator {
  return window.getByRole("alertdialog", { name: DIALOG_TITLE });
}

async function expectRgbPanelStillReadsItsPixels(window: Page): Promise<void> {
  const readout = await readPixelValueAt(window, PANEL, 0, 0, RGB_DIMENSIONS);
  expect(readout.value).toBe(RGB_TOP_LEFT_RED_VALUE);
}

async function closeMainWindowAndAwaitAppExit(launched: LaunchedApp): Promise<void> {
  const exited = waitForAppToExit(launched);
  await triggerMainWindowClose(launched.app);
  await exited;
}

function waitForAppToExit(launched: LaunchedApp): Promise<unknown> {
  return launched.app.waitForEvent("close", { timeout: 30_000 });
}
