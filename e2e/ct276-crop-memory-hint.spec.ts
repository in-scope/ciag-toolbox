import { expect, test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperation,
  applyOperationInPlace,
  countPanels,
  loadFixtureAsStack,
  openOperation,
  selectOperationRegionByDrag,
  selectPanel,
} from "./support/page-objects";
import { runAsStoryboardStep } from "./support/storyboard-step";

// CT-276: cropping to a NEW panel leaves the full-size original alive, so its
// success toast appends "Closing the original panel frees its memory." An
// in-place crop replaces the source and shows no hint. Fixture
// multiband-12bit.tif; oracle is the sonner toast's exact text.

const PANEL = 1;
const CROP = "Crop to Region";
const SOURCE_DIMENSIONS = { width: multiBandTiff.width, height: multiBandTiff.height };

const QUARTER_REGION_TOP_LEFT = { x: 0, y: 0 };
const QUARTER_REGION_BOTTOM_RIGHT = { x: 1, y: 1 };

const PLAIN_SUCCESS_TOAST = "Crop to region applied";
const MEMORY_HINT_SENTENCE = "Closing the original panel frees its memory.";
const NEW_PANEL_SUCCESS_TOAST = `${PLAIN_SUCCESS_TOAST}. ${MEMORY_HINT_SENTENCE}`;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, PANEL);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("cropping to a new panel toasts the memory hint", async () => {
  await openCropWithQuarterRegionSelected();
  await applyOperation(launched.window, CROP);
  await runAsStoryboardStep(launched.window, "The success toast carries the memory hint", async () => {
    await expect(successToastTitle()).toHaveText(NEW_PANEL_SUCCESS_TOAST);
  });
  expect(await countPanels(launched.window)).toBe(2);
});

test("an in-place crop toasts without the hint", async () => {
  await openCropWithQuarterRegionSelected();
  await applyOperationInPlace(launched.window, CROP);
  await runAsStoryboardStep(launched.window, "The success toast omits the memory hint", async () => {
    await expect(successToastTitle()).toHaveText(PLAIN_SUCCESS_TOAST);
    await expect(launched.window.getByText(MEMORY_HINT_SENTENCE)).toHaveCount(0);
  });
  expect(await countPanels(launched.window)).toBe(1);
});

function successToastTitle() {
  return launched.window
    .locator("[data-sonner-toast]", { hasText: PLAIN_SUCCESS_TOAST })
    .locator("[data-title]");
}

async function openCropWithQuarterRegionSelected(): Promise<void> {
  await openOperation(launched.window, CROP);
  await selectOperationRegionByDrag(launched.window, {
    panelNumber: PANEL,
    operationLabel: CROP,
    startPixel: QUARTER_REGION_TOP_LEFT,
    endPixel: QUARTER_REGION_BOTTOM_RIGHT,
    imageDimensions: SOURCE_DIMENSIONS,
  });
}
