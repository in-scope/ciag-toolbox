import { expect, test } from "@playwright/test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { expectPixelReadoutToEqual } from "./support/assertions";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import {
  clickGridBackgroundToClearSelection,
  createTemporaryExportDirectory,
  exportSelectedStackAsPngStackToFolder,
  loadFixtureAsStack,
  loadImageFromAbsolutePath,
  readMetadata,
  selectGridLayout,
  selectPanel,
} from "./support/page-objects";
import { runAsStoryboardStep } from "./support/storyboard-step";

// CT-273: exporting a stack as a 16-bit PNG stack writes one PNG per band
// into a chosen folder, named <base>_band_00N.png. The oracle is the file
// count (equal to the band count) plus reopening one band file IN-APP through
// the CT-272 16-bit decode path: multiband-12bit.tif band 3 holds
// 1600 + 10*i at row-major index i, all above 255, so the pixel readout can
// only report these values if the export kept full 16-bit precision.

const PNG_STACK_16_BIT_LABEL = "PNG stack (16-bit, one file per band)";
const BAND_THREE_BASE_VALUE = 1600;
const BAND_VALUE_STEP = 10;
const REOPENED_PANEL = 2;

const EXPECTED_BAND_FILE_NAMES = [
  "multiband-12bit_band_001.png",
  "multiband-12bit_band_002.png",
  "multiband-12bit_band_003.png",
];

test("a stack exported as a 16-bit PNG stack writes one exact file per band", async () => {
  const launched = await launchToolboxApp();
  try {
    await loadStackIntoTwoPanelGrid(launched.window);
    const exportFolder = await createTemporaryExportDirectory();
    await exportSelectedStackAsPngStackToFolder({
      app: launched.app,
      page: launched.window,
      formatLabel: PNG_STACK_16_BIT_LABEL,
      destinationFolder: exportFolder,
    });
    await expectOneFilePerBandInFolder(launched.window, exportFolder);
    await expectReopenedBandThreeKeepsExactValues(launched.window, exportFolder);
  } finally {
    await closeToolboxApp(launched);
  }
});

async function loadStackIntoTwoPanelGrid(window: Page): Promise<void> {
  await selectGridLayout(window, "1x2");
  await clickGridBackgroundToClearSelection(window);
  await loadFixtureAsStack(window, multiBandTiff.fileName);
}

async function expectOneFilePerBandInFolder(
  window: Page,
  exportFolder: string,
): Promise<void> {
  await runAsStoryboardStep(window, "The folder holds one PNG per band", async () => {
    const fileNames = (await readdir(exportFolder)).sort();
    expect(fileNames).toEqual(EXPECTED_BAND_FILE_NAMES);
    expect(fileNames.length).toBe(multiBandTiff.bandCount);
  });
}

// Band 3's values (1600..1750) all exceed 255, so an exact readout proves the
// 16-bit encode + the CT-272 16-bit open path, not an 8-bit approximation.
async function expectReopenedBandThreeKeepsExactValues(
  window: Page,
  exportFolder: string,
): Promise<void> {
  await loadImageFromAbsolutePath(window, join(exportFolder, "multiband-12bit_band_003.png"));
  await selectPanel(window, REOPENED_PANEL);
  await runAsStoryboardStep(window, "The reopened band file reads back exact 16-bit values", async () => {
    const metadata = await readMetadata(window);
    expect(metadata.bandCount).toBe("1");
    expect(metadata.bitsPerSample).toBe("16");
    await expectCornerReadoutsMatchBandThreeRamp(window);
  });
}

async function expectCornerReadoutsMatchBandThreeRamp(window: Page): Promise<void> {
  const dimensions = { width: multiBandTiff.width, height: multiBandTiff.height };
  const corners = [
    { x: 0, y: 0 },
    { x: multiBandTiff.width - 1, y: multiBandTiff.height - 1 },
  ];
  for (const corner of corners) {
    const rowMajorIndex = corner.y * multiBandTiff.width + corner.x;
    await expectPixelReadoutToEqual(window, {
      panel: REOPENED_PANEL,
      imageX: corner.x,
      imageY: corner.y,
      dimensions,
      expected: BAND_THREE_BASE_VALUE + rowMajorIndex * BAND_VALUE_STEP,
    });
  }
}
