import { expect, test } from "@playwright/test";

import { enviStack } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  expectSpectrumLineSubpathCount,
  loadFixtureAsStack,
  pinPixelSpectrum,
  readMetadata,
  readPinnedSpectrumLinePointXs,
  removeDisplayedBand,
  selectActiveBandNumber,
} from "./support/page-objects";

// CT-149 / CT-090 / manual section 16: spectra gap handling for removed bands.
//
// The ENVI stack is a 3-band uint16 raster carrying wavelengths 450/550/650, so the Spectra
// plot uses a WAVELENGTH x-axis. Each pinned spectrum line is a single <path fill="none"> whose
// `d` starts a new "M" subpath per CONTIGUOUS run of kept ORIGINAL band numbers, and each point's
// x is the deterministic projection of its wavelength across the kept bands' min..max range.
//
// Removing the MIDDLE band breaks the line into two subpaths (a gap, no straight bridge) while
// the surviving endpoints keep their original wavelength x-positions (the axis min/max are
// unchanged). Removing the FIRST or LAST band leaves a single contiguous run (no spurious
// leading/trailing gap).

const PANEL = 1;
const DIMENSIONS = { width: enviStack.width, height: enviStack.height };
const SAMPLE_PIXEL = { x: 0, y: 0 };
const MIDDLE_BAND = 2;
const FIRST_BAND = 1;
const LAST_BAND = 3;

test.describe("CT-149: removing a middle band gaps the spectrum and keeps wavelength positions", () => {
  let launched: LaunchedApp;

  test.beforeAll(async () => {
    launched = await launchToolboxApp();
    await loadFixtureAsStack(launched.window, enviStack.headerFileName);
  });

  test.afterAll(async () => {
    await closeToolboxApp(launched);
  });

  test("breaks the line at the removed band without shifting the kept bands", async () => {
    await pinSamplePixelSpectrum(launched);
    await expectSpectrumLineSubpathCount(launched.window, 1);
    const wavelengthPointXs = await readPinnedSpectrumLinePointXs(launched.window);
    expect(wavelengthPointXs).toHaveLength(enviStack.bandCount);

    await removeBandFromStack(launched, MIDDLE_BAND);
    await expectBandCountToBe(launched, 2);

    await pinSamplePixelSpectrum(launched);
    await expectSpectrumLineSubpathCount(launched.window, 2);
    await expectKeptBandXsToEqual(launched, withoutMiddleBandPosition(wavelengthPointXs));
  });
});

test.describe("CT-149: removing the first or last band leaves no spurious gap", () => {
  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchToolboxApp();
    await loadFixtureAsStack(launched.window, enviStack.headerFileName);
  });

  test.afterEach(async () => {
    await closeToolboxApp(launched);
  });

  test("removing the first band draws one contiguous run (no leading gap)", async () => {
    await removeBandFromStack(launched, FIRST_BAND);
    await expectBandCountToBe(launched, 2);

    await pinSamplePixelSpectrum(launched);
    await expectSpectrumLineSubpathCount(launched.window, 1);
  });

  test("removing the last band draws one contiguous run (no trailing gap)", async () => {
    await removeBandFromStack(launched, LAST_BAND);
    await expectBandCountToBe(launched, 2);

    await pinSamplePixelSpectrum(launched);
    await expectSpectrumLineSubpathCount(launched.window, 1);
  });
});

async function pinSamplePixelSpectrum(launched: LaunchedApp): Promise<void> {
  await pinPixelSpectrum(launched.window, PANEL, SAMPLE_PIXEL.x, SAMPLE_PIXEL.y, DIMENSIONS);
}

async function removeBandFromStack(launched: LaunchedApp, bandNumber: number): Promise<void> {
  await selectActiveBandNumber(launched.window, bandNumber);
  await removeDisplayedBand(launched.window, bandNumber);
}

async function expectBandCountToBe(launched: LaunchedApp, expected: number): Promise<void> {
  await expect.poll(async () => (await readMetadata(launched.window)).bandCount).toBe(String(expected));
}

async function expectKeptBandXsToEqual(launched: LaunchedApp, expected: number[]): Promise<void> {
  await expect.poll(() => readPinnedSpectrumLinePointXs(launched.window)).toEqual(expected);
}

function withoutMiddleBandPosition(bandPointXs: number[]): number[] {
  const middleIndex = Math.floor(bandPointXs.length / 2);
  return bandPointXs.filter((_, index) => index !== middleIndex);
}
