import { expect, test } from "@playwright/test";
import { join } from "node:path";
import sharp from "sharp";
import type { Page } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperationInPlace,
  createTemporaryExportDirectory,
  exportSelectedStackThroughSaveDialog,
  loadFixtureAsStack,
  openOperation,
  readPixelValueAt,
  selectPanel,
  toggleNormalizedViewing,
  type PixelDimensions,
} from "./support/page-objects";
import { runAsStoryboardStep } from "./support/storyboard-step";

// CT-296: PNG and JPEG exports save the image AS VIEWED. encode-canvas used to
// build its pixels from the RAW band values with no display mapping, so a
// 12-bit RGB Color Composite that reads correctly on screen saved as something
// else entirely (its 800-1750 green/blue samples saturated the 8-bit canvas
// while the red band stayed dark). The export now runs the same display
// mapping the renderer runs: data-type scaling, then the normalized-viewing
// stretch over the composite's per-channel extents.
//
// FIXTURE: multiband-12bit.tif (4x4 uint16, three ramp bands 100-250 /
// 800-950 / 1600-1750; band value = base + 10 * rowMajorIndex).
// ORACLES: a REFERENCE DECODER (sharp) reading the saved file back byte for
// byte, plus the pixel-readout oracle proving the panel's DATA is untouched by
// saving.

const PANEL = 1;
const COMPOSITE_LABEL = "RGB Color Composite";
const DIMENSIONS: PixelDimensions = {
  width: multiBandTiff.width,
  height: multiBandTiff.height,
};
const PIXEL_COUNT = multiBandTiff.width * multiBandTiff.height;
const BAND_BASE_VALUES = [100, 800, 1600] as const;
const BAND_VALUE_STEP = 10;
const UINT16_CONTAINER_MAX = 65535;
const BYTE_MAX = 255;
const PROBE = { x: 0, y: 0 };

// Normalized viewing stretches each channel from its own min/max to the full
// display range. All three bands are the SAME ramp shifted by a constant, so
// every channel stretches to the same fraction: pixel i reads
// round(255 * i / (pixelCount - 1)) in all of R, G and B.
const EXPECTED_NORMALIZED_RGB_BYTES = buildExpectedRgbBytes((_bandIndex, pixelIndex) =>
  Math.round((BYTE_MAX * pixelIndex) / (PIXEL_COUNT - 1)),
);

// With normalized viewing off the display maps the uint16 DATA-TYPE range to
// black-to-white, so 12-bit samples render dim: red 0-1, green 3-4, blue 6-7.
const EXPECTED_DEFAULT_VIEW_RGB_BYTES = buildExpectedRgbBytes((bandIndex, pixelIndex) =>
  Math.round(
    ((BAND_BASE_VALUES[bandIndex] ?? 0) + pixelIndex * BAND_VALUE_STEP) * BYTE_MAX /
      UINT16_CONTAINER_MAX,
  ),
);

function buildExpectedRgbBytes(
  byteForBandPixel: (bandIndex: number, pixelIndex: number) => number,
): number[] {
  const bytes: number[] = [];
  for (let pixelIndex = 0; pixelIndex < PIXEL_COUNT; pixelIndex += 1) {
    for (let bandIndex = 0; bandIndex < 3; bandIndex += 1) {
      bytes.push(byteForBandPixel(bandIndex, pixelIndex));
    }
  }
  return bytes;
}

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("a 12-bit composite exported as PNG carries the normalized view it was saved from", async () => {
  await buildTwelveBitCompositeInFirstPanel(launched.window);
  await test.step("turn normalized viewing on so the composite fills the display range", async () => {
    await toggleNormalizedViewing(launched.window, PANEL);
  });
  const exportPath = await exportCurrentViewAsPng("composite-normalized.png");
  await expectSavedPngRgbBytesToEqual(exportPath, EXPECTED_NORMALIZED_RGB_BYTES);
  await expectCompositeDataReadoutUnchangedBySaving();
});

test("a 12-bit composite exported as PNG carries the dim default view it was saved from", async () => {
  await buildTwelveBitCompositeInFirstPanel(launched.window);
  const exportPath = await exportCurrentViewAsPng("composite-default-view.png");
  await expectSavedPngRgbBytesToEqual(exportPath, EXPECTED_DEFAULT_VIEW_RGB_BYTES);
  await expectCompositeDataReadoutUnchangedBySaving();
});

async function buildTwelveBitCompositeInFirstPanel(window: Page): Promise<void> {
  await loadFixtureAsStack(window, multiBandTiff.fileName);
  await selectPanel(window, PANEL);
  await openOperation(window, COMPOSITE_LABEL);
  await applyOperationInPlace(window, COMPOSITE_LABEL);
}

async function exportCurrentViewAsPng(fileName: string): Promise<string> {
  const exportPath = join(await createTemporaryExportDirectory(), fileName);
  await exportSelectedStackThroughSaveDialog({
    app: launched.app,
    page: launched.window,
    formatLabel: "PNG (8-bit)",
    destinationPath: exportPath,
  });
  return exportPath;
}

// sharp decodes the saved PNG independently of the app (the CT-271 reference
// decoder pattern); removeAlpha keeps the comparison to the three colour
// channels the export is about.
async function expectSavedPngRgbBytesToEqual(
  exportPath: string,
  expectedBytes: ReadonlyArray<number>,
): Promise<void> {
  await runAsStoryboardStep(launched.window, "Reference-decode the exported PNG", async () => {
    const { data, info } = await sharp(exportPath)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info).toMatchObject({
      width: multiBandTiff.width,
      height: multiBandTiff.height,
      channels: 3,
    });
    expect(Array.from(data)).toEqual(expectedBytes);
  });
}

async function expectCompositeDataReadoutUnchangedBySaving(): Promise<void> {
  await runAsStoryboardStep(launched.window, "The panel's data is untouched by saving", async () => {
    const readout = await readPixelValueAt(launched.window, PANEL, PROBE.x, PROBE.y, DIMENSIONS);
    expect(readout.value).toBe(String(multiBandTiff.samplePixels[0]!.valuesPerBand[0]!));
  });
}
