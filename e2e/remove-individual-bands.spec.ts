import { expect, test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  cancelPendingBandRemoval,
  closeSubsetBandsEditorWithoutApplying,
  confirmPendingBandRemoval,
  expectHistoryToRecordOperation,
  expectSpectrumLineSubpathCount,
  historyEntryCount,
  loadFixtureAsStack,
  openSubsetBandsEditor,
  pinPixelSpectrum,
  readHistoryEntries,
  readMetadata,
  readPixelValueAt,
  removeBandButton,
  removeBandConfirmationDialog,
  removeDisplayedBand,
  selectActiveBandNumber,
  selectPanel,
  subsetBandsKeepCheckboxes,
  subsetBandsToggleButton,
} from "./support/page-objects";
import { runAsStoryboardStep } from "./support/storyboard-step";

// CT-150 / CT-091 / manual section 17: remove individual bands via the panel x.
//
// The band navigator carries a small "Remove band N" trash button per band. Clicking it removes just
// that band from the working stack through the SAME engine as Subset Bands
// (App.removeSingleBandFromViewportInPlace -> BAND_SUBSET_ACTION), so removal is a real,
// recorded operation: the band count drops by one, the spectrum gaps at the removed
// position, Metadata stays consistent, and History records a "Subset Bands" entry naming
// the KEPT bands by original number. Successive removals accumulate distinct entries, and
// the Subset Bands multi-select toolbar mode remains available alongside the x.
//
// STALE-AC (no E2E-BUG): the AC says History names the "removed" band, but the app records
// the KEPT bands by original number (formatKeptOriginalBandsHistoryLabel, unit-test-documented
// in apply-band-keep.test.ts). Per testFailureProtocol step 1 the spec asserts the real
// wording; the removed band is the gap in that kept list.

const PANEL = 1;
const SUBSET_HISTORY_LABEL = "Subset Bands";
const DIMENSIONS = { width: multiBandTiff.width, height: multiBandTiff.height };
const SAMPLE_PIXEL = { x: 0, y: 0 };

test.describe("CT-150: remove a single band via its x", () => {
  let launched: LaunchedApp;

  test.beforeAll(async () => {
    launched = await launchToolboxApp();
    await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
    await selectPanel(launched.window, PANEL);
  });

  test.afterAll(async () => {
    await closeToolboxApp(launched);
  });

  test("decrements the count, gaps the spectra, updates Metadata, and records History", async () => {
    expect(await historyEntryCount(launched.window)).toBe(0);
    await pinSamplePixelSpectrum(launched);
    await expectSpectrumLineSubpathCount(launched.window, 1);

    await selectActiveBandNumber(launched.window, 2);
    await removeDisplayedBand(launched.window, 2);

    await expectBandCountToBe(launched, 2);
    expect(await historyEntryCount(launched.window)).toBe(1);
    await expectHistoryToRecordOperation(launched.window, {
      actionLabel: SUBSET_HISTORY_LABEL,
      detailSubstrings: ["Kept bands 1, 3"],
    });

    await pinSamplePixelSpectrum(launched);
    await expectSpectrumLineSubpathCount(launched.window, 2);
  });
});

test.describe("CT-150: successive removals and the retained Subset Bands mode", () => {
  let launched: LaunchedApp;

  test.beforeAll(async () => {
    launched = await launchToolboxApp();
    await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
    await selectPanel(launched.window, PANEL);
  });

  test.afterAll(async () => {
    await closeToolboxApp(launched);
  });

  test("accumulates distinct History entries while Subset Bands stays available", async () => {
    await removeDisplayedBand(launched.window, 1);
    await expectBandCountToBe(launched, 2);
    expect(await historyEntryCount(launched.window)).toBe(1);

    await expectSubsetBandsModeStillWorks(launched, 2);

    await removeDisplayedBand(launched.window, 1);
    await expectBandCountToBe(launched, 1);
    await expectTwoDistinctRemovalEntries(launched);
  });
});

// CT-254: the trash button opens a confirmation AlertDialog before removing anything,
// because removal is irreversible (no undo). Cancel and Esc leave the stack byte-identical
// with no History entry; confirm runs the SAME Subset Bands removal path as before.
// Fixture: multiband-12bit.tif (3 bands, band bases 100/800/1600 at pixel (0,0)); oracle:
// the pixel readout of the remaining bands plus the Metadata band count and History.

test.describe("CT-254: removing a band asks for confirmation first", () => {
  let launched: LaunchedApp;

  test.beforeAll(async () => {
    launched = await launchToolboxApp();
    await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
    await selectPanel(launched.window, PANEL);
  });

  test.afterAll(async () => {
    await closeToolboxApp(launched);
  });

  test("cancel and Esc keep the stack untouched; confirm removes the band", async () => {
    await runAsStoryboardStep(launched.window, "Trash click opens the dialog, not removal", () =>
      expectTrashClickOpensConfirmationDialogWithoutRemoving(launched),
    );
    await runAsStoryboardStep(launched.window, "Cancel keeps 3 bands and no History", () =>
      expectCancelLeavesStackUntouched(launched),
    );
    await runAsStoryboardStep(launched.window, "Esc dismisses without removing", () =>
      expectEscapeLeavesStackUntouched(launched),
    );
    await runAsStoryboardStep(launched.window, "Confirm removes band 1 via Subset Bands", () =>
      expectConfirmRemovesBandAndRecordsHistory(launched),
    );
    await runAsStoryboardStep(launched.window, "Remaining bands read out original 2 and 3", () =>
      expectRemainingBandsReadOutOriginalValues(launched),
    );
  });
});

async function expectTrashClickOpensConfirmationDialogWithoutRemoving(
  launched: LaunchedApp,
): Promise<void> {
  await removeBandButton(launched.window, 1).click();
  const dialog = removeBandConfirmationDialog(launched.window);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Remove band 1?" })).toBeVisible();
  await expect(dialog).toContainText(
    "Band 1 of 3 will be removed from the stack. This cannot be undone.",
  );
  await expectBandCountToBe(launched, 3);
}

async function expectCancelLeavesStackUntouched(launched: LaunchedApp): Promise<void> {
  await cancelPendingBandRemoval(launched.window);
  await expectBandCountToBe(launched, 3);
  expect(await historyEntryCount(launched.window)).toBe(0);
}

async function expectEscapeLeavesStackUntouched(launched: LaunchedApp): Promise<void> {
  await removeBandButton(launched.window, 1).click();
  await expect(removeBandConfirmationDialog(launched.window)).toBeVisible();
  await launched.window.keyboard.press("Escape");
  await expect(removeBandConfirmationDialog(launched.window)).toBeHidden();
  await expectBandCountToBe(launched, 3);
  expect(await historyEntryCount(launched.window)).toBe(0);
}

async function expectConfirmRemovesBandAndRecordsHistory(launched: LaunchedApp): Promise<void> {
  await removeBandButton(launched.window, 1).click();
  await confirmPendingBandRemoval(launched.window);
  await expectBandCountToBe(launched, 2);
  expect(await historyEntryCount(launched.window)).toBe(1);
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: SUBSET_HISTORY_LABEL,
    detailSubstrings: ["Kept bands 2, 3"],
  });
}

async function expectRemainingBandsReadOutOriginalValues(launched: LaunchedApp): Promise<void> {
  await expectDisplayedBandValueAtOrigin(launched, 1, 800);
  await expectDisplayedBandValueAtOrigin(launched, 2, 1600);
}

async function expectDisplayedBandValueAtOrigin(
  launched: LaunchedApp,
  bandNumber: number,
  expectedValue: number,
): Promise<void> {
  await selectActiveBandNumber(launched.window, bandNumber);
  const readout = await readPixelValueAt(launched.window, PANEL, 0, 0, DIMENSIONS);
  expect(Number.parseFloat(readout.value)).toBe(expectedValue);
}

async function pinSamplePixelSpectrum(launched: LaunchedApp): Promise<void> {
  await pinPixelSpectrum(launched.window, PANEL, SAMPLE_PIXEL.x, SAMPLE_PIXEL.y, DIMENSIONS);
}

async function expectBandCountToBe(launched: LaunchedApp, expected: number): Promise<void> {
  await expect.poll(async () => (await readMetadata(launched.window)).bandCount).toBe(String(expected));
}

async function expectSubsetBandsModeStillWorks(launched: LaunchedApp, expectedRows: number): Promise<void> {
  await expect(subsetBandsToggleButton(launched.window)).toBeEnabled();
  await openSubsetBandsEditor(launched.window);
  await expect(subsetBandsKeepCheckboxes(launched.window)).toHaveCount(expectedRows);
  await closeSubsetBandsEditorWithoutApplying(launched.window);
}

async function expectTwoDistinctRemovalEntries(launched: LaunchedApp): Promise<void> {
  expect(await historyEntryCount(launched.window)).toBe(2);
  const entries = await readHistoryEntries(launched.window);
  const details = entries.map((entry) => entry.detailLines.join(" "));
  expect(new Set(details).size).toBe(2);
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: SUBSET_HISTORY_LABEL,
    detailSubstrings: ["Kept bands 2, 3"],
  });
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: SUBSET_HISTORY_LABEL,
    detailSubstrings: ["Kept bands 3"],
  });
}
