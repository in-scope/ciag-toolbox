import { test, expect } from "@playwright/test";

import {
  enviStack,
  flatFieldReferenceTiff,
  lowContrastGrayPng,
  multiBandTiff,
  rgbPng,
} from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  cancelReplacePicker,
  chooseReplaceTargetPanel,
  clickGridBackgroundToClearSelection,
  confirmReplaceWithChosenTarget,
  duplicateMenuItem,
  duplicatePanelViaContextMenu,
  duplicateReplacePicker,
  expectPanelHoldsFile,
  expectPanelIsEmpty,
  loadFixtureAsStack,
  openPanelContextMenu,
  panelCanvasCenter,
  readPixelValueAt,
  selectGridLayout,
  wheelAtPagePoint,
  type PixelDimensions,
} from "./support/page-objects";

// Manual test script section 10 (CT-010): duplicate a panel into another panel with
// overwrite protection. The Stage-3 app redesigned the Stage-1 "Duplicate to..." submenu
// (manual 10.2/10.3): the context menu now exposes a single "Duplicate" item that clones
// into the lowest-index empty cell (growing the grid one step if there is room). The
// auto-placement + replace-picker behaviour is documented by unit tests
// (find-empty-viewport.test.ts, apply-action-flow.test.ts), so per testFailureProtocol
// the submenu list is a stale manual detail and the spec asserts the real Stage-3 flow.
// Overwrite protection now surfaces only when the grid is at its 6-cell maximum AND every
// cell is full: a "Replace which panel?" Dialog (Cancel leaves unchanged, Replace
// overwrites) stands in for the Stage-1 AlertDialog.

const MULTIBAND_DIMENSIONS: PixelDimensions = {
  width: multiBandTiff.width,
  height: multiBandTiff.height,
};

const MULTIBAND_FIRST_BAND_VALUE_AT_ORIGIN = readFirstBandValueAtOrigin();

function readFirstBandValueAtOrigin(): number {
  const originValue = multiBandTiff.samplePixels[0]?.valuesPerBand[0];
  if (originValue === undefined) throw new Error("multiband fixture is missing its (0,0) sample");
  return originValue;
}

let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchToolboxApp();
});

test.afterAll(async () => {
  await closeToolboxApp(launched);
});

test("right-clicking a populated panel opens a context menu with a Duplicate item", async () => {
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await openPanelContextMenu(launched.window, 1);
  await expect(duplicateMenuItem(launched.window)).toBeVisible();
  await launched.window.keyboard.press("Escape");
  await expect(duplicateMenuItem(launched.window)).toHaveCount(0);
});

test("duplicating into an empty panel copies the content and keeps pan/zoom independent", async () => {
  const app = await launchToolboxApp();
  try {
    await loadMultibandIntoFirstOfTwoPanels(app);
    await duplicatePanelViaContextMenu(app.window, 1);
    await expectBothPanelsShowTheSameDuplicatedContent(app);
    await zoomSecondPanelAndAssertFirstPanelUnchanged(app);
  } finally {
    await closeToolboxApp(app);
  }
});

test("duplicating into a full max-size grid prompts a replace picker honouring Cancel and Replace", async () => {
  const app = await launchToolboxApp();
  try {
    await fillEverySixPanelOfMaxGrid(app);
    await cancelReplaceAndAssertTargetUnchanged(app);
    await confirmReplaceAndAssertTargetOverwritten(app);
  } finally {
    await closeToolboxApp(app);
  }
});

async function loadMultibandIntoFirstOfTwoPanels(app: LaunchedApp): Promise<void> {
  await selectGridLayout(app.window, "1x2");
  await clickGridBackgroundToClearSelection(app.window);
  await loadFixtureAsStack(app.window, multiBandTiff.fileName);
  await expectPanelIsEmpty(app.window, 2);
}

async function expectBothPanelsShowTheSameDuplicatedContent(app: LaunchedApp): Promise<void> {
  await expectPanelHoldsFile(app.window, 2, multiBandTiff.fileName);
  await assertFirstBandPixelReadsItsKnownValue(app, 1);
  await assertFirstBandPixelReadsItsKnownValue(app, 2);
}

async function assertFirstBandPixelReadsItsKnownValue(
  app: LaunchedApp,
  panelNumber: number,
): Promise<void> {
  const readout = await readPixelValueAt(app.window, panelNumber, 0, 0, MULTIBAND_DIMENSIONS);
  expect(Number.parseInt(readout.value, 10)).toBe(MULTIBAND_FIRST_BAND_VALUE_AT_ORIGIN);
}

async function zoomSecondPanelAndAssertFirstPanelUnchanged(app: LaunchedApp): Promise<void> {
  const center = await panelCanvasCenter(app.window, 2);
  await wheelAtPagePoint(app.window, center, -1000, 3);
  await assertFirstBandPixelReadsItsKnownValue(app, 1);
  await expect(readPixelValueAt(app.window, 2, 0, 0, MULTIBAND_DIMENSIONS)).rejects.toThrow();
}

async function fillEverySixPanelOfMaxGrid(app: LaunchedApp): Promise<void> {
  await selectGridLayout(app.window, "2x3");
  await clickGridBackgroundToClearSelection(app.window);
  await loadFiveDistinctStacks(app);
  await duplicatePanelViaContextMenu(app.window, 1);
  await expectPanelHoldsFile(app.window, 6, lowContrastGrayPng.fileName);
}

async function loadFiveDistinctStacks(app: LaunchedApp): Promise<void> {
  await loadFixtureAsStack(app.window, lowContrastGrayPng.fileName);
  await loadFixtureAsStack(app.window, rgbPng.fileName);
  await loadFixtureAsStack(app.window, multiBandTiff.fileName);
  await loadFixtureAsStack(app.window, flatFieldReferenceTiff.fileName);
  await loadFixtureAsStack(app.window, enviStack.headerFileName);
}

async function cancelReplaceAndAssertTargetUnchanged(app: LaunchedApp): Promise<void> {
  await duplicatePanelViaContextMenu(app.window, 1);
  await expect(duplicateReplacePicker(app.window)).toBeVisible();
  await chooseReplaceTargetPanel(app.window, 2, rgbPng.fileName);
  await cancelReplacePicker(app.window);
  await expectPanelHoldsFile(app.window, 2, rgbPng.fileName);
}

async function confirmReplaceAndAssertTargetOverwritten(app: LaunchedApp): Promise<void> {
  await duplicatePanelViaContextMenu(app.window, 1);
  await chooseReplaceTargetPanel(app.window, 2, rgbPng.fileName);
  await confirmReplaceWithChosenTarget(app.window);
  await expectPanelHoldsFile(app.window, 2, lowContrastGrayPng.fileName);
}
