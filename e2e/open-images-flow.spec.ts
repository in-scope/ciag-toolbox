import { test, expect } from "@playwright/test";

import {
  enviStack,
  fixturePath,
  flatFieldReferenceTiff,
  lowContrastGrayPng,
  maskMultibandPng,
  multiBandTiff,
  rgbPng,
} from "./fixtures/fixture-manifest";
import { writeTemporaryGrayscalePngVariantFixtures } from "./support/create-temporary-png-fixture";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import { toggleChannelView } from "./support/channel-view";
import {
  clickReviewModalRecombineIntoOneStack,
  reviewModalRecombineIntoOneStackButton,
  applicationToolbar,
  cancelReplaceTargetPicker,
  chooseOpenImagesReplaceTargetPanel,
  chooseReviewModalGroupMode,
  confirmReplaceTargetPicker,
  confirmReviewModal,
  DISTINCT_VALUE_BAND_FIXTURE_SIDE,
  enqueueAndTriggerOpenImages,
  exportMaskButton,
  expectPanelHoldsFile,
  goToBandNumberInputInPanel,
  historyEntryCount,
  importMaskFromPath,
  loadFixtureAsStack,
  maskLayerOptions,
  openImagesErrorToast,
  openImagesReplaceTargetPicker,
  openImagesReviewModal,
  openMasksOptions,
  panelCell,
  readMetadata,
  readPixelValueAt,
  readReviewModalRowFileNamesInOrder,
  reviewModalGroupModeSelect,
  reviewModalGroups,
  reviewModalRows,
  selectActiveBandNumberInPanel,
  selectGridLayout,
  selectPanel,
  clickGridBackgroundToClearSelection,
  writeTemporaryCorruptImageFixture,
  writeTemporaryDistinctValueWavelengthBandFixtures,
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

// CT-252: choosing "Open bands separately" physically splits the proposed stack group
// into one single-image group per row, exactly like files that arrive isolated; each
// image then opens in its own panel, distinguished by the pixel-readout oracle (every
// band file holds a uniform value equal to its wavelength).
test("'Open bands separately' splits the group into single-image rows that open in their own panels", async () => {
  const app = await launchToolboxApp();
  try {
    const bandFiles = await writeTemporaryDistinctValueWavelengthBandFixtures();
    await enqueueAndTriggerOpenImages(app.window, bandFiles.map((file) => file.filePath));
    await expectReviewModalShowsOneProposedStackGroup(app);
    await chooseReviewModalGroupMode(app.window, "Open bands separately");
    await expectReviewModalShowsOneSingleImageGroupPerFile(app, bandFiles);
    await confirmReviewModal(app.window);
    await expectEachBandFileLandedInItsOwnPanel(app, bandFiles);
  } finally {
    await closeToolboxApp(app);
  }
});

// CT-264: after "Open bands separately" splits a group, a "Recombine into one
// stack" affordance restores the pre-split group (same rows, same order, mode
// stack) and disappears once recombined. Fixture: the CT-263 grayscale PNG trio
// (low-contrast-gray.png plus two temp-generated uniform-value variants).
test("'Recombine into one stack' restores a split group that opens as one combined stack", async () => {
  const app = await launchToolboxApp();
  try {
    await enqueueAndTriggerOpenImages(app.window, await writeGrayscalePngTrioPaths());
    await expectReviewModalShowsOneProposedStackGroup(app);
    const preSplitRowOrder = await readReviewModalRowFileNamesInOrder(app.window);
    await chooseReviewModalGroupMode(app.window, "Open bands separately");
    await expect(reviewModalGroups(app.window)).toHaveCount(3);
    await recombineSplitRowsAndExpectRestoredStack(app, preSplitRowOrder);
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

// CT-323: opening a file into an already-occupied panel through the replace-target
// picker must reset that panel's rendering state exactly like an empty-panel open -
// masks, band selection, and History must never carry over from the stack that just
// got replaced. Panel 1 starts as multiband-12bit.tif (a real 3-band scientific stack,
// so the mask-multiband.png fixture's 4x4 mask fits and the band navigator is real,
// not hidden) with a mask layer and band 3 selected; rgb.png then replaces it through
// the picker. rgb.png is a true-colour photo (CT-159: no band navigator while shown as
// a composite), so the reset band index is read by toggling "view channels
// separately" (CT-248), which makes the composite scroll like any 3-band stack.
test("opening a file into an occupied panel through the replace picker resets the panel's state", async () => {
  const app = await launchToolboxApp();
  try {
    await test.step("fill a 2x3 grid with panel 1 holding multiband-12bit.tif", async () => {
      await fillMaxGridWithMultiBandTiffInPanelOne(app);
    });
    await test.step("give panel 1 a mask layer and select band 3", async () => {
      await selectPanel(app.window, 1);
      await openMasksOptions(app.window);
      await importMaskFromPath(app.window, fixturePath(maskMultibandPng.fileName));
      await expect(maskLayerOptions(app.window)).toHaveCount(1);
      await selectActiveBandNumberInPanel(app.window, 1, 3);
      await expect(goToBandNumberInputInPanel(app.window, 1)).toHaveValue("3");
    });
    await test.step("open rgb.png into panel 1 through the replace-target picker", async () => {
      await enqueueAndTriggerOpenImages(app.window, [fixturePath(rgbPng.fileName)]);
      await expect(openImagesReplaceTargetPicker(app.window)).toBeVisible();
      await chooseOpenImagesReplaceTargetPanel(
        app.window,
        rgbPng.fileName,
        1,
        multiBandTiff.fileName,
      );
      await confirmReplaceTargetPicker(app.window);
      await expectPanelHoldsFile(app.window, 1, rgbPng.fileName);
    });
    await expectPanelOneStateIsFullyReset(app);
  } finally {
    await closeToolboxApp(app);
  }
});

async function fillMaxGridWithMultiBandTiffInPanelOne(app: LaunchedApp): Promise<void> {
  await selectGridLayout(app.window, "2x3");
  await clickGridBackgroundToClearSelection(app.window);
  await loadFixtureAsStack(app.window, multiBandTiff.fileName);
  await loadFixtureAsStack(app.window, lowContrastGrayPng.fileName);
  await loadFixtureAsStack(app.window, flatFieldReferenceTiff.fileName);
  await loadFixtureAsStack(app.window, enviStack.headerFileName);
  await loadFixtureAsStack(app.window, multiBandTiff.fileName);
  await loadFixtureAsStack(app.window, multiBandTiff.fileName);
  await expectPanelHoldsFile(app.window, 1, multiBandTiff.fileName);
  await expectPanelHoldsFile(app.window, 6, multiBandTiff.fileName);
}

async function expectPanelOneStateIsFullyReset(app: LaunchedApp): Promise<void> {
  await test.step("the Masks aside lists no layers for panel 1 and Export mask is disabled", async () => {
    await expect(maskLayerOptions(app.window)).toHaveCount(0);
    await expect(exportMaskButton(app.window)).toBeDisabled();
  });
  await test.step("the band navigator reads band 1 of 3", async () => {
    await toggleChannelView(app.window, 1);
    const navigator = panelCell(app.window, 1).getByTestId("viewport-band-navigator");
    await expect(navigator).toBeVisible();
    await expect(navigator).toContainText("/ 3");
    await expect(goToBandNumberInputInPanel(app.window, 1)).toHaveValue("1");
  });
  await test.step("History is empty", async () => {
    expect(await historyEntryCount(app.window)).toBe(0);
  });
}

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

async function expectReviewModalShowsOneProposedStackGroup(app: LaunchedApp): Promise<void> {
  await expect(openImagesReviewModal(app.window)).toBeVisible();
  await expect(reviewModalGroups(app.window)).toHaveCount(1);
  await expect(openImagesReviewModal(app.window).getByLabel(/^Multi-band Stack 1/)).toBeVisible();
  await expect(reviewModalRows(app.window)).toHaveCount(3);
}

async function expectReviewModalShowsOneSingleImageGroupPerFile(
  app: LaunchedApp,
  bandFiles: ReadonlyArray<WavelengthStackFixtureFile>,
): Promise<void> {
  await expect(reviewModalGroups(app.window)).toHaveCount(bandFiles.length);
  await expect(reviewModalRows(app.window)).toHaveCount(bandFiles.length);
  expect(await readReviewModalRowFileNamesInOrder(app.window)).toEqual(
    bandFiles.map((file) => file.fileName),
  );
  await expectSplitGroupsLookLikeIsolatedSingles(app, bandFiles.length);
}

async function expectSplitGroupsLookLikeIsolatedSingles(
  app: LaunchedApp,
  fileCount: number,
): Promise<void> {
  const modal = openImagesReviewModal(app.window);
  await expect(modal.getByLabel(/bands open separately \(1 rows\)/)).toHaveCount(fileCount);
  await expect(modal.getByLabel(/^Multi-band Stack/)).toHaveCount(0);
  await expect(reviewModalGroupModeSelect(app.window)).toHaveCount(0);
  await expect(modal.getByRole("button", { name: `Open ${fileCount} stacks` })).toBeEnabled();
}

async function expectEachBandFileLandedInItsOwnPanel(
  app: LaunchedApp,
  bandFiles: ReadonlyArray<WavelengthStackFixtureFile>,
): Promise<void> {
  const side = DISTINCT_VALUE_BAND_FIXTURE_SIDE;
  for (const [index, file] of bandFiles.entries()) {
    const panelNumber = index + 1;
    await expectPanelHoldsFile(app.window, panelNumber, file.fileName);
    const readout = await readPixelValueAt(app.window, panelNumber, side / 2, side / 2, {
      width: side,
      height: side,
    });
    expect(Number.parseInt(readout.value, 10)).toBe(file.wavelength);
  }
}

async function writeGrayscalePngTrioPaths(): Promise<ReadonlyArray<string>> {
  const variants = await writeTemporaryGrayscalePngVariantFixtures();
  return [fixturePath(lowContrastGrayPng.fileName), ...variants.map((variant) => variant.filePath)];
}

async function recombineSplitRowsAndExpectRestoredStack(
  app: LaunchedApp,
  preSplitRowOrder: ReadonlyArray<string>,
): Promise<void> {
  await expect(reviewModalRecombineIntoOneStackButton(app.window)).toBeVisible();
  await clickReviewModalRecombineIntoOneStack(app.window);
  await expect(reviewModalRecombineIntoOneStackButton(app.window)).toBeHidden();
  await expect(reviewModalGroups(app.window)).toHaveCount(1);
  await expect(
    openImagesReviewModal(app.window).getByLabel(/^Multi-band Stack 1 \(3 rows\)/),
  ).toBeVisible();
  expect(await readReviewModalRowFileNamesInOrder(app.window)).toEqual(preSplitRowOrder);
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
