import { expect, test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperation,
  countPanels,
  loadFixtureAsStack,
  openOperation,
  readMetadata,
  selectOperationRegionByDrag,
  selectPanel,
} from "./support/page-objects";

// CT-266: the Metadata section shows a "Data size" row computed from the CURRENT
// raster (width x height x bands x bytes per sample), never the original file's
// size. multiband-12bit.tif is 4x4, 3-band uint16, so the source reads
// 4*4*3*2 = 96 B; cropping to a 2x2 quarter region opens a new panel whose row
// must read the recomputed 2*2*3*2 = 24 B exactly.

const PANEL = 1;
const RESULT_PANEL = 2;
const CROP = "Crop to Region";
const SOURCE_DIMENSIONS = { width: multiBandTiff.width, height: multiBandTiff.height };

const QUARTER_REGION_TOP_LEFT = { x: 0, y: 0 };
const QUARTER_REGION_BOTTOM_RIGHT = { x: 1, y: 1 };

const UINT16_BYTES_PER_SAMPLE = 2;

const SOURCE_DATA_SIZE = dataSizeText(multiBandTiff.width, multiBandTiff.height);
const CROPPED_DATA_SIZE = dataSizeText(2, 2);

function dataSizeText(width: number, height: number): string {
  return `${width * height * multiBandTiff.bandCount * UINT16_BYTES_PER_SAMPLE} B`;
}

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, PANEL);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("Data size shows the current raster's bytes and shrinks after a quarter crop", async () => {
  await expectActivePanelDataSize(SOURCE_DATA_SIZE);
  await cropSourceToQuarterRegionInNewPanel();
  expect(await countPanels(launched.window)).toBe(RESULT_PANEL);
  await selectPanel(launched.window, RESULT_PANEL);
  await expectActivePanelDataSize(CROPPED_DATA_SIZE);
});

async function expectActivePanelDataSize(expected: string): Promise<void> {
  const metadata = await readMetadata(launched.window);
  expect(metadata.dataSize).toBe(expected);
}

async function cropSourceToQuarterRegionInNewPanel(): Promise<void> {
  await openOperation(launched.window, CROP);
  await selectOperationRegionByDrag(launched.window, {
    panelNumber: PANEL,
    operationLabel: CROP,
    startPixel: QUARTER_REGION_TOP_LEFT,
    endPixel: QUARTER_REGION_BOTTOM_RIGHT,
    imageDimensions: SOURCE_DIMENSIONS,
  });
  await applyOperation(launched.window, CROP);
}
