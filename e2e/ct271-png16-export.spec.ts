import { expect, test } from "@playwright/test";
import { join } from "node:path";
import sharp from "sharp";
import type { Page } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import {
  clickGridBackgroundToClearSelection,
  createTemporaryExportDirectory,
  exportSelectedStackThroughSaveDialog,
  loadFixtureAsStack,
  loadImageFromAbsolutePath,
  readMetadata,
  selectActiveBandNumber,
  selectGridLayout,
} from "./support/page-objects";
import { runAsStoryboardStep } from "./support/storyboard-step";

// CT-271: 16-bit PNG export. The renderer streams the displayed band's raw
// big-endian uint16 samples through the chunked save-image protocol and the
// MAIN process encodes the PNG with Node zlib. The exactness oracle is a
// REFERENCE DECODER (sharp/libvips in this spec's Node context) reading the
// exported file back sample-for-sample: multiband-12bit.tif band 2 holds
// 800 + 10*i at row-major index i, all above 255, so any 8-bit downgrade or
// endianness slip fails loudly. Reopening the export IN-APP goes through
// Chromium's decoder today, which downscales 16-bit PNGs to 8 bits; the
// pixel-readout assertion on the reopened panel therefore lands with CT-272's
// 16-bit open path, and this spec pins the reopen as a decodability smoke
// (independent second decoder) plus the preserved dimensions.

const BAND_TWO_BASE_VALUE = 800;
const BAND_VALUE_STEP = 10;

const EXPECTED_BAND_TWO_SAMPLES = Array.from(
  { length: multiBandTiff.width * multiBandTiff.height },
  (_, index) => BAND_TWO_BASE_VALUE + index * BAND_VALUE_STEP,
);

test("a band exported as 16-bit PNG keeps its exact 12-bit values", async () => {
  const launched = await launchToolboxApp();
  try {
    await loadStackIntoTwoPanelGrid(launched.window);
    await selectActiveBandNumber(launched.window, 2);
    const exportPath = join(await createTemporaryExportDirectory(), "band2-16bit.png");
    await exportSelectedStackThroughSaveDialog({
      app: launched.app,
      page: launched.window,
      formatLabel: "PNG (16-bit)",
      destinationPath: exportPath,
    });
    await expectExportedPngHoldsExactBandTwoSamples(launched.window, exportPath);
    await expectExportReopensInAppWithPreservedDimensions(launched.window, exportPath);
  } finally {
    await closeToolboxApp(launched);
  }
});

async function loadStackIntoTwoPanelGrid(window: Page): Promise<void> {
  await selectGridLayout(window, "1x2");
  await clickGridBackgroundToClearSelection(window);
  await loadFixtureAsStack(window, multiBandTiff.fileName);
}

// toColourspace("grey16") keeps libvips in its 16-bit grayscale space; the
// default pipeline converts to 8-bit sRGB and would hide a precision loss.
async function expectExportedPngHoldsExactBandTwoSamples(
  window: Page,
  exportPath: string,
): Promise<void> {
  await runAsStoryboardStep(window, "Reference-decode the exported PNG", async () => {
    const { data, info } = await sharp(exportPath)
      .toColourspace("grey16")
      .raw({ depth: "ushort" })
      .toBuffer({ resolveWithObject: true });
    expect(info).toMatchObject({ width: multiBandTiff.width, height: multiBandTiff.height, channels: 1 });
    expect((await sharp(exportPath).metadata()).depth).toBe("ushort");
    const samples = new Uint16Array(data.buffer, data.byteOffset, data.byteLength / 2);
    expect(Array.from(samples)).toEqual(EXPECTED_BAND_TWO_SAMPLES);
  });
}

async function expectExportReopensInAppWithPreservedDimensions(
  window: Page,
  exportPath: string,
): Promise<void> {
  await loadImageFromAbsolutePath(window, exportPath);
  const metadata = await readMetadata(window);
  expect(metadata.width).toBe(String(multiBandTiff.width));
  expect(metadata.height).toBe(String(multiBandTiff.height));
}
