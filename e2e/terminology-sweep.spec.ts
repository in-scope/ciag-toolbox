import { test, expect } from "@playwright/test";

import { fixturePath, lowContrastGrayPng, multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  activateRegionTool,
  applicationToolbar,
  cancelReplaceTargetPicker,
  clickGridBackgroundToClearSelection,
  drawInspectionRoiBetweenPixels,
  enqueueAndTriggerOpenImages,
  expectNoUserFacingViewportWording,
  expectPanelHoldsFile,
  loadFixtureAsStack,
  openImagesReplaceTargetPicker,
  openImagesReviewModal,
  openOperation,
  panelCell,
  readReviewModalGroupModeOptionLabels,
  reviewModalNewStackButton,
  selectGridLayout,
  writeTemporaryWavelengthStackTiffFixtures,
} from "./support/page-objects";

// Manual test script section 27 (CT-101): the locked vocabulary band / stack / image /
// panel. The multi-file review modal uses stack wording, grid-open controls say "panel",
// a single-band source is still a "stack" (never relabelled "image" for one band), and
// no rendered text or accessible name exposes the internal word "viewport".

let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchToolboxApp();
});

test.afterAll(async () => {
  await closeToolboxApp(launched);
});

test("the multi-file review modal uses the locked stack vocabulary", async () => {
  const app = await launchToolboxApp();
  try {
    await openWavelengthStackReviewModal(app);
    await expectReviewModalShowsStackVocabulary(app);
  } finally {
    await closeToolboxApp(app);
  }
});

test("grid-open controls refer to panels, never viewports", async () => {
  const app = await launchToolboxApp();
  try {
    await fillEverySixPanelOfMaxGrid(app);
    await enqueueAndTriggerOpenImages(app.window, [fixturePath(multiBandTiff.fileName)]);
    await expectReplacePickerSpeaksOfPanelsNotViewports(app);
    await cancelReplaceTargetPicker(app.window);
  } finally {
    await closeToolboxApp(app);
  }
});

test("a single-band source is labelled a stack and never an image for one band", async () => {
  const app = await launchToolboxApp();
  try {
    await expectFreshLaunchUsesStackWordingNotImage(app);
    await loadFixtureAsStack(app.window, lowContrastGrayPng.fileName);
    await expectPanelHoldsFile(app.window, 1, lowContrastGrayPng.fileName);
    await expectLoadedPanelHeaderAvoidsImageNoun(app);
  } finally {
    await closeToolboxApp(app);
  }
});

test("no user-facing text or accessible name exposes the word viewport", async () => {
  await bringEveryRightPanelAndOperationSurfaceOnScreen(launched);
  await expectNoUserFacingViewportWording(launched.window);
});

async function openWavelengthStackReviewModal(app: LaunchedApp): Promise<void> {
  const stackFiles = await writeTemporaryWavelengthStackTiffFixtures();
  await enqueueAndTriggerOpenImages(app.window, stackFiles.map((file) => file.filePath));
  await expect(openImagesReviewModal(app.window)).toBeVisible();
}

async function expectReviewModalShowsStackVocabulary(app: LaunchedApp): Promise<void> {
  const modal = openImagesReviewModal(app.window);
  await expect(modal).toContainText("Review stacks");
  await expect(modal.getByLabel(/^Multi-band Stack 1/)).toBeVisible();
  await expect(reviewModalNewStackButton(app.window)).toBeVisible();
  expect(await readReviewModalGroupModeOptionLabels(app.window)).toEqual([
    "Combine into one stack",
    "Open bands separately",
  ]);
  await expect(modal.getByRole("button", { name: /^Open \d+ stack/ })).toBeVisible();
}

async function expectReplacePickerSpeaksOfPanelsNotViewports(app: LaunchedApp): Promise<void> {
  const picker = openImagesReplaceTargetPicker(app.window);
  await expect(picker).toBeVisible();
  await expect(picker).toContainText("panel");
  await expect(picker).not.toContainText(/viewport/i);
}

async function fillEverySixPanelOfMaxGrid(app: LaunchedApp): Promise<void> {
  await selectGridLayout(app.window, "2x3");
  await clickGridBackgroundToClearSelection(app.window);
  for (let panel = 1; panel <= 6; panel += 1) {
    await loadFixtureAsStack(app.window, multiBandTiff.fileName);
  }
  await expectPanelHoldsFile(app.window, 6, multiBandTiff.fileName);
}

async function expectFreshLaunchUsesStackWordingNotImage(app: LaunchedApp): Promise<void> {
  await expect(panelCell(app.window, 1)).toContainText("No stack loaded");
  const disabledOperation = applicationToolbar(app.window).getByRole("button", {
    name: /^Bit Shift \(select a panel with a loaded stack\)/,
  });
  await expect(disabledOperation).toBeVisible();
}

async function expectLoadedPanelHeaderAvoidsImageNoun(app: LaunchedApp): Promise<void> {
  const headerLabel = panelCell(app.window, 1).locator("span[title]");
  await expect(headerLabel).toBeVisible();
  expect((await headerLabel.getAttribute("title")) ?? "").not.toMatch(/\bimage\b/i);
}

async function bringEveryRightPanelAndOperationSurfaceOnScreen(app: LaunchedApp): Promise<void> {
  await loadFixtureAsStack(app.window, multiBandTiff.fileName);
  await openOperation(app.window, "Bit Shift");
  await activateRegionTool(app.window);
  await drawInspectionRoiBetweenPixels(
    app.window,
    1,
    { x: 0, y: 0 },
    { x: 2, y: 2 },
    { width: multiBandTiff.width, height: multiBandTiff.height },
  );
}
