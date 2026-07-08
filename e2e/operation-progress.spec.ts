import { expect, test } from "@playwright/test";
import { rm } from "node:fs/promises";
import type { Locator, Page } from "@playwright/test";

import {
  constantBandStackValueForBand,
  OPERATION_PROGRESS_STACK,
  openGeneratedStackAndAwaitLoad,
  readAnyHoveredPixelValue,
  writeTemporaryConstantBandStackTiff,
} from "./support/constant-band-stack";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import { openOperation, operationPanel, setOperationEnumParameter } from "./support/page-objects";
import { panelGrid, selectPanel } from "./support/panels";

// CT-221: applying a slow per-band operation to a large stack must show DETERMINATE
// progress (a progress bar plus a percentage number) on the result panel's busy
// overlay while the transform ticks through its bands, and the finished output must
// report true pixel values. The stack is generated at runtime (never committed);
// every band is constant, and a median filter leaves a constant band EXACTLY
// unchanged, so band 1 of the denoised output still reads 100 at any hovered pixel.

const DENOISE = "Denoise";
const DENOISE_LOADING_LABEL = "Denoising stack...";
const RESULT_PANEL = 2;
const LOAD_TIMEOUT_MS = 120_000;
const APPLY_COMPLETION_TIMEOUT_MS = 180_000;
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

test("a long median denoise shows percentage progress on the result overlay and outputs true values", async () => {
  test.setTimeout(300_000);
  const page = launched.window;
  const generated = await writeTemporaryConstantBandStackTiff(OPERATION_PROGRESS_STACK);
  generatedDirectory = generated.directory;
  await openGeneratedStackAndAwaitLoad(page, OPERATION_PROGRESS_STACK, generated, LOAD_TIMEOUT_MS);
  await startMedianDenoiseApply(page);
  await expectOperationOverlayShowsPercentageProgress(page);
  await expectApplyFinishes(page);
  await expectDenoisedBandOneStillReadsItsConstant(page);
});

async function startMedianDenoiseApply(page: Page): Promise<void> {
  await openOperation(page, DENOISE);
  await setOperationEnumParameter(page, DENOISE, "median");
  await operationPanel(page, DENOISE).getByRole("button", { name: "Apply", exact: true }).click();
}

async function expectOperationOverlayShowsPercentageProgress(page: Page): Promise<void> {
  const overlay = operationBusyOverlay(page);
  await expect(overlay.getByRole("progressbar")).toBeVisible({
    timeout: PROGRESS_APPEARANCE_TIMEOUT_MS,
  });
  await expect(overlay.getByText(PERCENT_TEXT_PATTERN)).toBeVisible();
}

function operationBusyOverlay(page: Page): Locator {
  return panelGrid(page).getByRole("status", { name: DENOISE_LOADING_LABEL });
}

async function expectApplyFinishes(page: Page): Promise<void> {
  await expect(operationBusyOverlay(page)).toBeHidden({ timeout: APPLY_COMPLETION_TIMEOUT_MS });
}

async function expectDenoisedBandOneStillReadsItsConstant(page: Page): Promise<void> {
  await selectPanel(page, RESULT_PANEL);
  const value = await readAnyHoveredPixelValue(page, RESULT_PANEL);
  expect(value).toBe(constantBandStackValueForBand(0));
}
