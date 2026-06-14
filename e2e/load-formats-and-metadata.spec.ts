import { test, expect } from "@playwright/test";

import {
  enviStack,
  flatFieldReferenceTiff,
  lowContrastGrayPng,
  multiBandTiff,
  rgbPng,
} from "./fixtures/fixture-manifest";
import type { EnviFixture, SingleFileFixture } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  expectMetadataDataTypeAndDimensions,
  loadFixtureAsStack,
  readMetadata,
  selectActiveBandNumber,
} from "./support/page-objects";
import type { MetadataReadout } from "./support/page-objects";

// Stage 2 CT-023..CT-028: every supported format loads through the CT-113 dialog stub and
// the Metadata panel reports the expected dimensions, band count, and data type; ENVI also
// reports per-band wavelengths. Each test relaunches into a clean single panel so the
// loaded stack auto-selects and its metadata is what the Metadata panel shows.
//
// REAL-APP NOTE (not an E2E-BUG, STALE AC): PNG/JPG load through the browser decode path as
// image-bitmap sources with no per-channel raster, so the Metadata panel reports dimensions
// but shows "-" for band count and data type. This is intended, unit-test-documented
// behaviour (image-metadata-display.test.ts "uses placeholders for fields unavailable on
// browser sources"), so the PNG cases assert the placeholder rather than a count/type.
//
// RAW-FORMAT (deferred, see progress.txt): a raw case is explicitly out of scope here - raw
// camera files are large real captures, not kilobyte fixtures, and raw import needs a
// dimensions/data-type dialog the stub does not model.

test("loads a single-band TIFF and reports dimensions, band count, and data type", async () => {
  await withFixtureLoadedInFreshApp(flatFieldReferenceTiff.fileName, async (window) => {
    await expectRasterMetadataMatchesFixture(window, flatFieldReferenceTiff, "TIFF");
  });
});

test("loads a multi-band TIFF stack and reports dimensions, band count, and data type", async () => {
  await withFixtureLoadedInFreshApp(multiBandTiff.fileName, async (window) => {
    await expectRasterMetadataMatchesFixture(window, multiBandTiff, "TIFF");
  });
});

test("loads a grayscale PNG and reports dimensions with placeholder band count/data type", async () => {
  await withFixtureLoadedInFreshApp(lowContrastGrayPng.fileName, async (window) => {
    await expectBrowserImageMetadataMatchesFixture(window, lowContrastGrayPng, "PNG");
  });
});

test("loads an RGB PNG and reports dimensions with placeholder band count/data type", async () => {
  await withFixtureLoadedInFreshApp(rgbPng.fileName, async (window) => {
    await expectBrowserImageMetadataMatchesFixture(window, rgbPng, "PNG");
  });
});

test("loads a single-file ENVI stack and reports metadata plus per-band wavelengths", async () => {
  await withFixtureLoadedInFreshApp(enviStack.headerFileName, async (window) => {
    await expectEnviStackMetadataAndWavelengths(window, enviStack);
  });
});

async function withFixtureLoadedInFreshApp(
  fixtureFileName: string,
  assertMetadata: (window: LaunchedApp["window"]) => Promise<void>,
): Promise<void> {
  const app = await launchToolboxApp();
  try {
    await loadFixtureAsStack(app.window, fixtureFileName);
    await assertMetadata(app.window);
  } finally {
    await closeToolboxApp(app);
  }
}

async function expectRasterMetadataMatchesFixture(
  window: LaunchedApp["window"],
  fixture: SingleFileFixture,
  expectedFormat: string,
): Promise<void> {
  await expectMetadataDataTypeAndDimensions(window, {
    dataType: fixture.dataType,
    width: fixture.width,
    height: fixture.height,
  });
  const metadata = await readMetadata(window);
  expect(metadata.format).toBe(expectedFormat);
  expect(metadata.bandCount).toBe(String(fixture.bandCount));
}

async function expectBrowserImageMetadataMatchesFixture(
  window: LaunchedApp["window"],
  fixture: SingleFileFixture,
  expectedFormat: string,
): Promise<void> {
  const metadata = await readMetadata(window);
  expect(metadata.format).toBe(expectedFormat);
  expect(metadata.width).toBe(String(fixture.width));
  expect(metadata.height).toBe(String(fixture.height));
  expectBrowserSourcePlaceholdersForBandCountAndDataType(metadata);
}

function expectBrowserSourcePlaceholdersForBandCountAndDataType(metadata: MetadataReadout): void {
  expect(metadata.bandCount).toBe("-");
  expect(metadata.sampleFormat).toBe("-");
  expect(metadata.bitsPerSample).toBe("-");
}

async function expectEnviStackMetadataAndWavelengths(
  window: LaunchedApp["window"],
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
  await expectEachBandReportsItsWavelength(window, fixture.wavelengths);
}

async function expectEachBandReportsItsWavelength(
  window: LaunchedApp["window"],
  wavelengths: ReadonlyArray<number>,
): Promise<void> {
  for (const [bandIndex, wavelengthNm] of wavelengths.entries()) {
    await expectBandReportsWavelength(window, bandIndex + 1, wavelengthNm);
  }
}

async function expectBandReportsWavelength(
  window: LaunchedApp["window"],
  oneBasedBandNumber: number,
  wavelengthNm: number,
): Promise<void> {
  await selectActiveBandNumber(window, oneBasedBandNumber);
  await expect
    .poll(async () => (await readMetadata(window)).wavelength)
    .toBe(`${wavelengthNm} nm`);
}
