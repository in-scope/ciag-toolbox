import { test, expect } from "@playwright/test";
import { launchToolboxApp, closeToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";

let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchToolboxApp();
});

test.afterAll(async () => {
  await closeToolboxApp(launched);
});

test("main window reports the application title", async () => {
  await expect(launched.window).toHaveTitle("MSI Toolbox v3");
});

test("renderer mounts the root element", async () => {
  await expect(launched.window.locator("#root")).toBeAttached();
});
