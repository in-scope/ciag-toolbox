import { expect, test } from "@playwright/test";
import { rm } from "node:fs/promises";
import type { Locator, Page } from "@playwright/test";

import {
  LOADING_PROGRESS_STACK,
  loadingProgressStackValueForBand,
  writeTemporaryLoadingProgressStackTiff,
} from "./support/generate-loading-progress-stack";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import { enqueueAndTriggerOpenImages } from "./support/open-images-flow";
import { panelCanvas, panelGrid } from "./support/panels";
import { statusBar } from "./support/pixel-readout";

// CT-220: opening a large single multiband TIFF must show DETERMINATE progress (a
// progress bar plus a percentage number) on the destination viewport's busy overlay
// while the decode ticks through its bands, and afterwards the loaded panel must
// report true pixel values. The stack is generated at runtime into a temp directory
// (never committed); every band holds one constant value, so any hovered pixel is an
// exact oracle (band 1 reads 100 everywhere).

const LOAD_COMPLETION_TIMEOUT_MS = 180_000;
const PROGRESS_APPEARANCE_TIMEOUT_MS = 60_000;
const PERCENT_TEXT_PATTERN = /^\d+%$/;

let launched: LaunchedApp;
let generatedDirectory: string | null = null;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
  if (generatedDirectory !== null) {
    await rm(generatedDirectory, { recursive: true, force: true });
    generatedDirectory = null;
  }
});

test("a long single-file load shows percentage progress on the viewport overlay and loads true values", async () => {
  test.setTimeout(300_000);
  const page = launched.window;
  const generated = await writeTemporaryLoadingProgressStackTiff();
  generatedDirectory = generated.directory;
  await enqueueAndTriggerOpenImages(page, [generated.filePath]);
  await expectViewportOverlayShowsPercentageProgress(page);
  await expectStackFinishesLoading(page);
  await expectHoveredPixelReadsBandOneConstant(page);
});

async function expectViewportOverlayShowsPercentageProgress(page: Page): Promise<void> {
  const overlay = viewportReadingOverlay(page);
  await expect(overlay.getByRole("progressbar")).toBeVisible({
    timeout: PROGRESS_APPEARANCE_TIMEOUT_MS,
  });
  await expect(overlay.getByText(PERCENT_TEXT_PATTERN)).toBeVisible();
}

function viewportReadingOverlay(page: Page): Locator {
  return panelGrid(page).getByRole("status", {
    name: `Reading ${LOADING_PROGRESS_STACK.fileName}...`,
  });
}

async function expectStackFinishesLoading(page: Page): Promise<void> {
  await expect(
    panelGrid(page).getByText(LOADING_PROGRESS_STACK.fileName, { exact: false }).first(),
  ).toBeVisible({ timeout: LOAD_COMPLETION_TIMEOUT_MS });
  await expect(viewportReadingOverlay(page)).toBeHidden();
}

async function expectHoveredPixelReadsBandOneConstant(page: Page): Promise<void> {
  const value = await readAnyHoveredPixelValue(page, 1);
  expect(value).toBe(loadingProgressStackValueForBand(0));
}

// Every pixel of a band holds the same value, so the oracle does not need an exact
// pixel hover at this scale: whatever pixel the status bar reports must read the
// band constant.
async function readAnyHoveredPixelValue(page: Page, panelNumber: number): Promise<number> {
  const box = await panelCanvas(page, panelNumber).boundingBox();
  if (!box) throw new Error(`Panel ${panelNumber} canvas has no bounding box`);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await hoverNearCanvasCenter(page, box, attempt);
    const value = await tryReadPixelReadoutValueOrNull(page);
    if (value !== null) return value;
  }
  throw new Error("Pixel readout never populated while hovering the loaded panel");
}

interface CanvasBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

async function hoverNearCanvasCenter(page: Page, box: CanvasBox, attempt: number): Promise<void> {
  const nudgeX = attempt % 5;
  const nudgeY = Math.floor(attempt / 5) % 3;
  await page.mouse.move(box.x + box.width / 2 + nudgeX, box.y + box.height / 2 + nudgeY);
  await page.waitForTimeout(60);
}

async function tryReadPixelReadoutValueOrNull(page: Page): Promise<number | null> {
  const valueField = statusBar(page).getByTestId("pixel-readout-value");
  if ((await valueField.count()) === 0) return null;
  const value = Number.parseFloat((await valueField.innerText()).trim().replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}
