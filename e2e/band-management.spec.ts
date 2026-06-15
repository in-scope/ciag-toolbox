import { expect, test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applySubsetBands,
  expectHistoryToRecordOperation,
  expectSpectrumLineSubpathCount,
  loadFixtureAsStack,
  openSubsetBandsEditor,
  pinPixelSpectrum,
  readMetadata,
  removeDisplayedBand,
  selectActiveBandNumber,
  selectPanel,
  setSubsetBandsOpenInNewPanel,
  uncheckSubsetBandRow,
} from "./support/page-objects";

// CT-131 / CT-041 / manual sections 16-17: band keep/remove and subset.
// multiband-12bit.tif is a 3-band uint16 stack (original bands 1, 2, 3, no wavelengths).
//
// Removing the MIDDLE band (band 2) via its x drops the band count to 2, records a History
// entry naming the kept bands by ORIGINAL number, and breaks the pinned spectrum into two
// subpaths (a visible gap where band 2 was). The Subset Bands multi-select mode still exists
// and removes a chosen set, leaving the band count consistent.
//
// STALE-AC (no E2E-BUG): the AC says History should name the "removed" band, but the app
// records the KEPT bands by original number ("Kept bands 1, 3 of the original stack",
// unit-test-documented in apply-band-keep.test.ts formatKeptOriginalBandsHistoryLabel). The
// removed band is the gap in that kept list, so per testFailureProtocol step 1 the spec
// asserts the real wording rather than parking a bug.

const PANEL = 1;
const SUBSET_HISTORY_LABEL = "Subset Bands";
const DIMENSIONS = { width: multiBandTiff.width, height: multiBandTiff.height };
const SAMPLE_PIXEL = { x: 0, y: 0 };

test.describe("CT-131: remove a middle band via its x", () => {
  let launched: LaunchedApp;

  test.beforeAll(async () => {
    launched = await launchToolboxApp();
    await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
    await selectPanel(launched.window, PANEL);
  });

  test.afterAll(async () => {
    await closeToolboxApp(launched);
  });

  test("drops the band count, records History, and gaps the spectra", async () => {
    await pinSamplePixelSpectrum(launched);
    await expectSpectrumLineSubpathCount(launched.window, 1);

    await selectActiveBandNumber(launched.window, 2);
    await removeDisplayedBand(launched.window, 2);

    await expectBandCountToBe(launched, 2);
    await expectHistoryToRecordOperation(launched.window, {
      actionLabel: SUBSET_HISTORY_LABEL,
      detailSubstrings: ["Kept bands 1, 3"],
    });

    await pinSamplePixelSpectrum(launched);
    await expectSpectrumLineSubpathCount(launched.window, 2);
  });
});

test.describe("CT-131: Subset Bands multi-select mode", () => {
  let launched: LaunchedApp;

  test.beforeAll(async () => {
    launched = await launchToolboxApp();
    await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
    await selectPanel(launched.window, PANEL);
  });

  test.afterAll(async () => {
    await closeToolboxApp(launched);
  });

  test("removes a selected set and keeps the band count consistent", async () => {
    await expectBandCountToBe(launched, 3);

    await openSubsetBandsEditor(launched.window);
    await uncheckSubsetBandRow(launched.window, 1);
    await uncheckSubsetBandRow(launched.window, 3);
    await setSubsetBandsOpenInNewPanel(launched.window, false);
    await applySubsetBands(launched.window);

    await expectBandCountToBe(launched, 1);
    await expectHistoryToRecordOperation(launched.window, {
      actionLabel: SUBSET_HISTORY_LABEL,
      detailSubstrings: ["Kept bands 2"],
    });
  });
});

async function pinSamplePixelSpectrum(launched: LaunchedApp): Promise<void> {
  await pinPixelSpectrum(launched.window, PANEL, SAMPLE_PIXEL.x, SAMPLE_PIXEL.y, DIMENSIONS);
}

async function expectBandCountToBe(launched: LaunchedApp, expected: number): Promise<void> {
  await expect.poll(async () => (await readMetadata(launched.window)).bandCount).toBe(String(expected));
}
