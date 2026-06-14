import { test, expect } from "@playwright/test";

import {
  enviStack,
  fixturePath,
  flatFieldReferenceTiff,
  lowContrastGrayPng,
  multiBandTiff,
  rgbPng,
} from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applicationToolbar,
  cancelReplaceTargetPicker,
  confirmReviewModal,
  enqueueAndTriggerOpenImages,
  expectPanelHoldsFile,
  loadFixtureAsStack,
  openImagesErrorToast,
  openImagesReplaceTargetPicker,
  openImagesReviewModal,
  readMetadata,
  readReviewModalRowFileNamesInOrder,
  reviewModalRows,
  selectGridLayout,
  clickGridBackgroundToClearSelection,
  writeTemporaryCorruptImageFixture,
  writeTemporaryWavelengthStackTiffFixtures,
  type WavelengthStackFixtureFile,
} from "./support/page-objects";

// Manual test script section 7 (CT-007 / CT-055): the unified Open Images flow.
// A single-file selection loads directly with no review modal; a corrupt file surfaces
// a non-blocking toast and leaves prior content intact; a multi-file selection of
// same-shape single-band TIFFs opens the "Review stacks" modal with one auto-suggested
// stack ordered by wavelength; and opening into a full 2x3 grid prompts the
// replace-target picker. Dialogs are driven through the CT-113 stub.

let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchToolboxApp();
});

test.afterAll(async () => {
  await closeToolboxApp(launched);
});

test("a single-file selection loads directly with no review modal", async () => {
  await loadFixtureAsStack(launched.window, lowContrastGrayPng.fileName);
  await expect(openImagesReviewModal(launched.window)).toBeHidden();
  await expectPanelHoldsFile(launched.window, 1, lowContrastGrayPng.fileName);
});

test("a corrupt file surfaces a non-blocking toast and leaves prior content intact", async () => {
  const app = await launchToolboxApp();
  const uncaughtErrors = collectPageErrors(app);
  try {
    await loadFixtureAsStack(app.window, lowContrastGrayPng.fileName);
    await openCorruptFileAndExpectToast(app);
    await expectPanelHoldsFile(app.window, 1, lowContrastGrayPng.fileName);
    expect(uncaughtErrors).toEqual([]);
  } finally {
    await closeToolboxApp(app);
  }
});

test("a multi-file selection opens the review modal with one wavelength-ordered stack", async () => {
  const app = await launchToolboxApp();
  try {
    const stackFiles = await writeTemporaryWavelengthStackTiffFixtures();
    await openWavelengthFilesOutOfOrder(app, stackFiles);
    await expectReviewModalShowsOneWavelengthOrderedStack(app);
    await confirmReviewModal(app.window);
    await expectFirstPanelHoldsThreeBandStack(app);
  } finally {
    await closeToolboxApp(app);
  }
});

test("opening a new image into a full 2x3 grid prompts the replace-target picker", async () => {
  const app = await launchToolboxApp();
  try {
    await fillEverySixPanelOfMaxGrid(app);
    await enqueueAndTriggerOpenImages(app.window, [fixturePath(rgbPng.fileName)]);
    await expect(openImagesReplaceTargetPicker(app.window)).toBeVisible();
    await cancelReplaceTargetPicker(app.window);
  } finally {
    await closeToolboxApp(app);
  }
});

function collectPageErrors(app: LaunchedApp): string[] {
  const errors: string[] = [];
  app.window.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function openCorruptFileAndExpectToast(app: LaunchedApp): Promise<void> {
  const corruptPath = await writeTemporaryCorruptImageFixture();
  await enqueueAndTriggerOpenImages(app.window, [corruptPath]);
  await expect(openImagesErrorToast(app.window).first()).toBeVisible();
  await expect(applicationToolbar(app.window)).toBeVisible();
}

async function openWavelengthFilesOutOfOrder(
  app: LaunchedApp,
  stackFiles: ReadonlyArray<WavelengthStackFixtureFile>,
): Promise<void> {
  const outOfOrderPaths = pickOutOfWavelengthOrderPaths(stackFiles);
  await enqueueAndTriggerOpenImages(app.window, outOfOrderPaths);
  await expect(openImagesReviewModal(app.window)).toBeVisible();
}

function pickOutOfWavelengthOrderPaths(
  stackFiles: ReadonlyArray<WavelengthStackFixtureFile>,
): ReadonlyArray<string> {
  const byWavelength = (target: number) =>
    stackFiles.find((file) => file.wavelength === target)?.filePath ?? "";
  return [byWavelength(650), byWavelength(450), byWavelength(550)];
}

async function expectReviewModalShowsOneWavelengthOrderedStack(app: LaunchedApp): Promise<void> {
  await expect(reviewModalRows(app.window)).toHaveCount(3);
  const fileNamesInOrder = await readReviewModalRowFileNamesInOrder(app.window);
  expect(fileNamesInOrder).toEqual([
    "capture_w450.tif",
    "capture_w550.tif",
    "capture_w650.tif",
  ]);
}

async function expectFirstPanelHoldsThreeBandStack(app: LaunchedApp): Promise<void> {
  await expect(openImagesReviewModal(app.window)).toBeHidden();
  const metadata = await readMetadata(app.window);
  expect(metadata.bandCount).toBe("3");
}

async function fillEverySixPanelOfMaxGrid(app: LaunchedApp): Promise<void> {
  await selectGridLayout(app.window, "2x3");
  await clickGridBackgroundToClearSelection(app.window);
  await loadFixtureAsStack(app.window, lowContrastGrayPng.fileName);
  await loadFixtureAsStack(app.window, rgbPng.fileName);
  await loadFixtureAsStack(app.window, multiBandTiff.fileName);
  await loadFixtureAsStack(app.window, flatFieldReferenceTiff.fileName);
  await loadFixtureAsStack(app.window, enviStack.headerFileName);
  await loadFixtureAsStack(app.window, multiBandTiff.fileName);
  await expectPanelHoldsFile(app.window, 6, multiBandTiff.fileName);
}
