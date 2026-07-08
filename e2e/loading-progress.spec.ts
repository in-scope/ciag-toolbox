import { expect, test } from "@playwright/test";
import { rm } from "node:fs/promises";
import type { Locator, Page } from "@playwright/test";

import {
  constantBandStackValueForBand,
  LOADING_PROGRESS_STACK,
  readAnyHoveredPixelValue,
  writeTemporaryConstantBandStackTiff,
} from "./support/constant-band-stack";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import { enqueueAndTriggerOpenImages } from "./support/open-images-flow";
import { panelGrid } from "./support/panels";

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
  const generated = await writeTemporaryConstantBandStackTiff(LOADING_PROGRESS_STACK);
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
  expect(value).toBe(constantBandStackValueForBand(0));
}
