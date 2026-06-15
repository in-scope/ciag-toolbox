import { test, expect } from "@playwright/test";
import { stat } from "node:fs/promises";
import { join } from "node:path";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import { triggerSaveImageMenuItem } from "./support/main-process";
import {
  cancelSaveImageFormatPicker,
  clickGridBackgroundToClearSelection,
  createTemporaryExportDirectory,
  expectMetadataDataTypeAndDimensions,
  expectPixelReadoutToEqual,
  exportSelectedStackThroughSaveDialog,
  loadFixtureAsStack,
  loadImageFromAbsolutePath,
  readMetadata,
  readOfferedSaveImageFormatLabels,
  readPixelValueAt,
  saveImageFormatPicker,
  selectGridLayout,
  type PixelDimensions,
} from "./support/page-objects";
import type { Page } from "@playwright/test";

// CT-128: Save/export round-trip (CT-031/CT-032). The save-dialog stub writes the encoded
// bytes (and an ENVI .bin sidecar) to a temp path; reloading them through the open stub must
// reproduce the same spot-checked pixel readouts. multiband-12bit.tif (uint16 4x4, band-0
// corners 100 and 250) doubles as the out-of-range-float oracle: every value is far above the
// float [0,1] display window, so a float export that came back with 100/250 intact proves the
// save path preserved out-of-range values losslessly rather than clipping them to [0,1].

const MULTIBAND_DIMENSIONS: PixelDimensions = {
  width: multiBandTiff.width,
  height: multiBandTiff.height,
};

const EXPECTED_SAVE_FORMAT_LABELS: ReadonlyArray<string> = [
  "TIFF (16-bit)",
  "TIFF (8-bit)",
  "TIFF (32-bit float)",
  "PNG (8-bit)",
  "JPEG (8-bit)",
  "ENVI (.hdr + .bin)",
  "ENVI (32-bit float)",
];

const FLOAT_READOUT_TOLERANCE = 0.01;

interface BandZeroCorners {
  readonly topLeft: number;
  readonly bottomRight: number;
}

test("the save format/bit-depth chooser offers the documented options", async () => {
  await withFreshApp(async ({ app, window }) => {
    await loadFixtureAsStack(window, multiBandTiff.fileName);
    await triggerSaveImageMenuItem(app);
    await expect(saveImageFormatPicker(window)).toBeVisible();
    expect(await readOfferedSaveImageFormatLabels(window)).toEqual(EXPECTED_SAVE_FORMAT_LABELS);
    await cancelSaveImageFormatPicker(window);
  });
});

test("exports a stack as 16-bit TIFF and reloads identical integer pixel values", async () => {
  await withFreshApp(async ({ app, window }) => {
    await loadMultibandIntoTwoPanelGrid(window);
    const before = await readSourceBandZeroCorners(window);
    const exportPath = join(await createTemporaryExportDirectory(), "roundtrip-16bit.tif");
    await exportSelectedStackThroughSaveDialog({ app, page: window, formatLabel: "TIFF (16-bit)", destinationPath: exportPath });
    await expectNonEmptyFileOnDisk(exportPath);
    await loadImageFromAbsolutePath(window, exportPath);
    await expectReloadedPanelMatches(window, "uint16", before, undefined);
  });
});

test("exports a stack as 32-bit float TIFF and reloads out-of-range values unclipped", async () => {
  await withFreshApp(async ({ app, window }) => {
    await loadMultibandIntoTwoPanelGrid(window);
    const before = await readSourceBandZeroCorners(window);
    const exportPath = join(await createTemporaryExportDirectory(), "roundtrip-float.tif");
    await exportSelectedStackThroughSaveDialog({ app, page: window, formatLabel: "TIFF (32-bit float)", destinationPath: exportPath });
    await expectNonEmptyFileOnDisk(exportPath);
    await loadImageFromAbsolutePath(window, exportPath);
    await expectReloadedPanelMatches(window, "float32", before, FLOAT_READOUT_TOLERANCE);
  });
});

test("exports the whole cube as 32-bit float ENVI and reloads all bands losslessly", async () => {
  await withFreshApp(async ({ app, window }) => {
    await loadMultibandIntoTwoPanelGrid(window);
    const before = await readSourceBandZeroCorners(window);
    const exportPath = join(await createTemporaryExportDirectory(), "roundtrip-cube.hdr");
    await exportSelectedStackThroughSaveDialog({ app, page: window, formatLabel: "ENVI (32-bit float)", destinationPath: exportPath });
    await expectNonEmptyFileOnDisk(exportPath);
    await expectNonEmptyFileOnDisk(replaceFileExtension(exportPath, "bin"));
    await loadImageFromAbsolutePath(window, exportPath);
    await expectReloadedCubeMatches(window, before);
  });
});

async function withFreshApp(run: (launched: LaunchedApp) => Promise<void>): Promise<void> {
  const launched = await launchToolboxApp();
  try {
    await run(launched);
  } finally {
    await closeToolboxApp(launched);
  }
}

// A 1x2 grid keeps panel 1 for the source and panel 2 for the reloaded copy. The background
// click after the layout change dismisses the lingering Grid Layout tooltip (CT-122) before
// any panel is hovered or loaded; no selection exists yet, so nothing is deselected.
async function loadMultibandIntoTwoPanelGrid(window: Page): Promise<void> {
  await selectGridLayout(window, "1x2");
  await clickGridBackgroundToClearSelection(window);
  await loadFixtureAsStack(window, multiBandTiff.fileName);
}

async function readSourceBandZeroCorners(window: Page): Promise<BandZeroCorners> {
  const topLeft = await readPixelValueAt(window, 1, 0, 0, MULTIBAND_DIMENSIONS);
  const bottomRight = await readPixelValueAt(window, 1, 3, 3, MULTIBAND_DIMENSIONS);
  return {
    topLeft: Number.parseFloat(topLeft.value),
    bottomRight: Number.parseFloat(bottomRight.value),
  };
}

async function expectReloadedPanelMatches(
  window: Page,
  dataType: string,
  before: BandZeroCorners,
  tolerance: number | undefined,
): Promise<void> {
  await expectMetadataDataTypeAndDimensions(window, { dataType, width: 4, height: 4 });
  await expectReloadedCornerEquals(window, 0, 0, before.topLeft, tolerance);
  await expectReloadedCornerEquals(window, 3, 3, before.bottomRight, tolerance);
}

async function expectReloadedCubeMatches(window: Page, before: BandZeroCorners): Promise<void> {
  const metadata = await readMetadata(window);
  expect(metadata.dataType).toBe("float32");
  expect(metadata.bandCount).toBe(String(multiBandTiff.bandCount));
  await expectReloadedCornerEquals(window, 0, 0, before.topLeft, FLOAT_READOUT_TOLERANCE);
  await expectReloadedCornerEquals(window, 3, 3, before.bottomRight, FLOAT_READOUT_TOLERANCE);
}

async function expectReloadedCornerEquals(
  window: Page,
  imageX: number,
  imageY: number,
  expected: number,
  tolerance: number | undefined,
): Promise<void> {
  await expectPixelReadoutToEqual(window, {
    panel: 2,
    imageX,
    imageY,
    dimensions: MULTIBAND_DIMENSIONS,
    expected,
    tolerance,
  });
}

async function expectNonEmptyFileOnDisk(filePath: string): Promise<void> {
  const stats = await stat(filePath);
  expect(stats.size).toBeGreaterThan(0);
}

function replaceFileExtension(filePath: string, newExtension: string): string {
  const lastDot = filePath.lastIndexOf(".");
  const stem = lastDot <= 0 ? filePath : filePath.slice(0, lastDot);
  return `${stem}.${newExtension}`;
}
