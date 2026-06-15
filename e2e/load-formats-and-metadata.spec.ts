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

// Stage 2 CT-023..CT-028: every supported format loads through the CT-113 dialog stub and
// the Metadata panel reports the expected dimensions, band count, and data type; ENVI also
// reports per-band wavelengths. Each test relaunches into a clean single panel so the
// loaded stack auto-selects and its metadata is what the Metadata panel shows.
//
// CT-172: PNG/JPG are now PROMOTED to rasters at load (App.applyLoadedImageAtIndex runs the
// decoded browser source through coerceViewportSourceToRasterSource), so the Metadata panel
// reports a sensible raster: a colour PNG is a 3-band uint8 rgb raster and a grayscale PNG is a
// single-band uint8 raster. (Before CT-172 a browser source showed "-" for band count/type.)
// The "format" field still comes from the file extension, so it stays "PNG".
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

test("loads a grayscale PNG promoted to a single-band uint8 raster", async () => {
  await withFixtureLoadedInFreshApp(lowContrastGrayPng.fileName, async (window) => {
    await expectRasterMetadataMatchesFixture(window, lowContrastGrayPng, "PNG");
  });
});

test("loads an RGB PNG promoted to a 3-band uint8 raster", async () => {
  await withFixtureLoadedInFreshApp(rgbPng.fileName, async (window) => {
    await expectRasterMetadataMatchesFixture(window, rgbPng, "PNG");
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
