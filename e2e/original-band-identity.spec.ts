import { test, expect } from "@playwright/test";

import { enviStack, multiBandTiff } from "./fixtures/fixture-manifest";
import type { EnviFixture, SingleFileFixture } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  expectHistoryToRecordOperation,
  expectNoOriginalBandAnnotationBesideBandSlider,
  loadFixtureAsStack,
  metadataSection,
  readMetadata,
  removeDisplayedBand,
  selectActiveBandNumber,
} from "./support/page-objects";

// CT-093 / manual section 19: each kept band's ORIGINAL identity (its index in the
// originally loaded cube, plus its wavelength when the source carries one) stays visible in
// the Metadata panel and is recorded in History after removals, so "band 3 of the working
// stack" can still be traced back to the physical capture. Explicitly rejected: annotating
// the band slider with the original index/wavelength.
//
// The ENVI fixture is the oracle for the index+wavelength rows (wavelengths 450/550/650);
// multiband-12bit.tif has no wavelengths, so it proves the index still shows with the
// wavelength gracefully absent (no "undefined").
//
// STALE-AC (no E2E-BUG): the manual/AC says History identifies the REMOVED bands, but the
// app records the KEPT bands by original number (formatKeptOriginalBandsHistoryLabel, the
// same engine documented for CT-131/CT-150), so per testFailureProtocol step 1 the spec
// asserts the real wording.

type AppWindow = LaunchedApp["window"];

interface ActiveBandIdentity {
  readonly originalBand: string | null;
  readonly wavelength: string | null;
}

test("Metadata shows the active band's original index and wavelength, tracking the slider", async () => {
  const app = await launchToolboxApp();
  try {
    await loadFixtureAsStack(app.window, enviStack.headerFileName);
    await expectEachBandReportsItsOriginalIndexAndWavelength(app.window, enviStack);
  } finally {
    await closeToolboxApp(app);
  }
});

test("After a removal a later band keeps its original index/wavelength and History names the kept bands", async () => {
  const app = await launchToolboxApp();
  try {
    await loadFixtureAsStack(app.window, enviStack.headerFileName);
    await removeMiddleBand(app.window);
    await expectRemainingBandsKeepOriginalIdentity(app.window);
    await expectHistoryNamesKeptOriginalBands(app.window);
  } finally {
    await closeToolboxApp(app);
  }
});

test("The band slider carries no original-index or wavelength annotation (rejected design)", async () => {
  const app = await launchToolboxApp();
  try {
    await loadFixtureAsStack(app.window, enviStack.headerFileName);
    await expectNoOriginalBandAnnotationBesideBandSlider(app.window);
  } finally {
    await closeToolboxApp(app);
  }
});

test("A stack without wavelengths still shows the original index with the wavelength gracefully absent", async () => {
  const app = await launchToolboxApp();
  try {
    await loadFixtureAsStack(app.window, multiBandTiff.fileName);
    await expectEachBandReportsOriginalIndexWithoutWavelength(app.window, multiBandTiff);
    await expectMetadataNeverRendersUndefined(app.window);
  } finally {
    await closeToolboxApp(app);
  }
});

async function expectEachBandReportsItsOriginalIndexAndWavelength(
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

async function removeMiddleBand(window: AppWindow): Promise<void> {
  await selectActiveBandNumber(window, 2);
  await removeDisplayedBand(window, 2);
  await expect.poll(() => readMetadata(window).then((data) => data.bandCount)).toBe("2");
}

async function expectRemainingBandsKeepOriginalIdentity(window: AppWindow): Promise<void> {
  await expectActiveBandIdentity(window, 1, { originalBand: "1", wavelength: "450 nm" });
  await expectActiveBandIdentity(window, 2, { originalBand: "3", wavelength: "650 nm" });
}

async function expectHistoryNamesKeptOriginalBands(window: AppWindow): Promise<void> {
  await expectHistoryToRecordOperation(window, {
    actionLabel: "Subset Bands",
    detailSubstrings: ["1, 3"],
  });
}

async function expectEachBandReportsOriginalIndexWithoutWavelength(
  window: AppWindow,
  fixture: SingleFileFixture,
): Promise<void> {
  for (let bandNumber = 1; bandNumber <= fixture.bandCount; bandNumber += 1) {
    await expectActiveBandIdentity(window, bandNumber, {
      originalBand: String(bandNumber),
      wavelength: null,
    });
  }
}

async function expectMetadataNeverRendersUndefined(window: AppWindow): Promise<void> {
  expect(await metadataSection(window).innerText()).not.toContain("undefined");
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
