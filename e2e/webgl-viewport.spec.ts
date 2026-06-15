import { test, expect } from "@playwright/test";

import { lowContrastGrayPng } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applicationToolbar,
  loadFixtureAsStack,
  panelCanvas,
} from "./support/page-objects";
import {
  nonClearPixelFraction,
  summarizeCanvasPixels,
} from "./support/canvas-pixels";
import {
  forcePanelCanvasContextLoss,
  readPanelCanvasWebglContextName,
  restorePanelCanvasContext,
} from "./support/webgl-context";

// Manual test script section 5 (CT-005): the central viewport renders via WebGL,
// shows non-blank content once a fixture loads, and survives a context loss/restore.

const VIEWPORT_PANEL = 1;
const MINIMUM_NON_CLEAR_FRACTION = 0.2;
const CONTEXT_LOSS_SETTLE_MS = 400;

let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchToolboxApp();
});

test.afterAll(async () => {
  await closeToolboxApp(launched);
});

test("the viewport canvas exposes a non-null WebGL2 context", async () => {
  const contextName = await readPanelCanvasWebglContextName(launched.window, VIEWPORT_PANEL);
  expect(contextName).toBe("WebGL2RenderingContext");
});

test("the canvas renders non-blank content after a fixture loads", async () => {
  await loadFixtureAsStack(launched.window, lowContrastGrayPng.fileName);
  const canvas = panelCanvas(launched.window, VIEWPORT_PANEL);
  await expect
    .poll(async () => nonClearPixelFraction(await summarizeCanvasPixels(canvas)))
    .toBeGreaterThan(MINIMUM_NON_CLEAR_FRACTION);
  const summary = await summarizeCanvasPixels(canvas);
  expect(summary.distinctColorCount).toBeGreaterThan(1);
});

test("forcing WebGL context loss and restore does not crash the app", async () => {
  const fresh = await launchToolboxApp();
  const uncaughtErrors = collectUncaughtPageErrors(fresh);
  try {
    await loseAndRestoreContext(fresh);
    expect(uncaughtErrors).toEqual([]);
    await expectAppSurvivedContextRecovery(fresh);
  } finally {
    await closeToolboxApp(fresh);
  }
});

function collectUncaughtPageErrors(app: LaunchedApp): string[] {
  const errors: string[] = [];
  app.window.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function loseAndRestoreContext(app: LaunchedApp): Promise<void> {
  await forcePanelCanvasContextLoss(app.window, VIEWPORT_PANEL);
  await app.window.waitForTimeout(CONTEXT_LOSS_SETTLE_MS);
  await restorePanelCanvasContext(app.window, VIEWPORT_PANEL);
  await app.window.waitForTimeout(CONTEXT_LOSS_SETTLE_MS);
}

async function expectAppSurvivedContextRecovery(app: LaunchedApp): Promise<void> {
  await expect(applicationToolbar(app.window)).toBeVisible();
  const contextName = await readPanelCanvasWebglContextName(app.window, VIEWPORT_PANEL);
  expect(contextName).toBe("WebGL2RenderingContext");
}
