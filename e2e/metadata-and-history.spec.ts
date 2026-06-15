import { test, expect } from "@playwright/test";

import { enviStack, multiBandTiff } from "./fixtures/fixture-manifest";
import type { EnviFixture } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperationInPlace,
  expectHistoryToRecordOperation,
  expectMetadataDataTypeAndDimensions,
  expectNormalizedViewingEnabled,
  historyEntryCount,
  loadFixtureAsStack,
  openOperation,
  readMetadata,
  selectActiveBandNumber,
  toggleNormalizedViewing,
} from "./support/page-objects";

// CT-035/CT-036: the Metadata panel reports format/dimensions/band count/data type and the
// active band's original index + wavelength (where available), updating as the band
// navigator moves; the History panel appends EXACTLY ONE entry per data-changing operation
// (recording its parameters) and NONE for display-only toggles like Normalized viewing.
//
// The ENVI fixture is the metadata oracle because it carries both an original band index and
// a per-band wavelength, so navigating bands proves both Metadata rows track the slider.
// Operations are applied IN PLACE (CT-127) so their History lands on the loaded panel.

type AppWindow = LaunchedApp["window"];

interface ActiveBandIdentity {
  readonly originalBand: string | null;
  readonly wavelength: string | null;
}

test("Metadata reports format, dimensions, band count, data type, and tracks the band navigator", async () => {
  const app = await launchToolboxApp();
  try {
    await loadFixtureAsStack(app.window, enviStack.headerFileName);
    await expectStackMetadataMatchesEnviFixture(app.window, enviStack);
    await expectEachBandReportsOriginalIndexAndWavelength(app.window, enviStack);
  } finally {
    await closeToolboxApp(app);
  }
});

test("History records exactly one entry per data-changing operation and none for display-only toggles", async () => {
  const app = await launchToolboxApp();
  try {
    await loadFixtureAsStack(app.window, multiBandTiff.fileName);
    await expectHistoryIsEmptyOnLoad(app.window);
    await expectEachDataChangingOperationAppendsExactlyOneEntry(app.window);
    await expectDisplayOnlyToggleRecordsNoHistoryEntry(app.window);
  } finally {
    await closeToolboxApp(app);
  }
});

async function expectStackMetadataMatchesEnviFixture(
  window: AppWindow,
  fixture: EnviFixture,
): Promise<void> {
  await expectMetadataDataTypeAndDimensions(window, {
    dataType: fixture.dataType,
    width: fixture.width,
    height: fixture.height,
  });
  const metadata = await readMetadata(window);
  expect(metadata.format).toBe("ENVI");
  expect(metadata.bandCount).toBe(String(fixture.bandCount));
}

async function expectEachBandReportsOriginalIndexAndWavelength(
  window: AppWindow,
  fixture: EnviFixture,
): Promise<void> {
  for (const [bandIndex, wavelengthNm] of fixture.wavelengths.entries()) {
    await expectActiveBandIdentity(window, bandIndex + 1, {
      originalBand: String(bandIndex + 1),
      wavelength: `${wavelengthNm} nm`,
    });
  }
}

async function expectActiveBandIdentity(
  window: AppWindow,
  oneBasedBandNumber: number,
  expected: ActiveBandIdentity,
): Promise<void> {
  await selectActiveBandNumber(window, oneBasedBandNumber);
  await expect.poll(() => readActiveBandIdentity(window)).toEqual(expected);
}

async function readActiveBandIdentity(window: AppWindow): Promise<ActiveBandIdentity> {
  const metadata = await readMetadata(window);
  return { originalBand: metadata.originalBand, wavelength: metadata.wavelength };
}

async function expectHistoryIsEmptyOnLoad(window: AppWindow): Promise<void> {
  expect(await historyEntryCount(window)).toBe(0);
}

async function expectEachDataChangingOperationAppendsExactlyOneEntry(
  window: AppWindow,
): Promise<void> {
  await applyBitShiftInPlace(window);
  await expect.poll(() => historyEntryCount(window)).toBe(1);
  await expectHistoryToRecordOperation(window, { actionLabel: "Bit Shift", detailSubstrings: ["+4"] });
  await applyBitShiftInPlace(window);
  await expect.poll(() => historyEntryCount(window)).toBe(2);
}

async function applyBitShiftInPlace(window: AppWindow): Promise<void> {
  await openOperation(window, "Bit Shift");
  await applyOperationInPlace(window, "Bit Shift");
}

async function expectDisplayOnlyToggleRecordsNoHistoryEntry(window: AppWindow): Promise<void> {
  await toggleNormalizedViewing(window, 1);
  await expectNormalizedViewingEnabled(window, 1, true);
  expect(await historyEntryCount(window)).toBe(2);
}
