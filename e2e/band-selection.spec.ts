import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperation,
  BAND_SELECTION_OPERATION_LABEL,
  clickBandSelectionPreset,
  clickImportBandSelectionScript,
  countPanels,
  enqueueOpenDialogPaths,
  expectBandSelectionEditorReady,
  expectBandSelectionFunction,
  expectHistoryToRecordOperation,
  expectMetadataDataTypeAndDimensions,
  expectPixelReadoutToEqual,
  loadFixtureAsStack,
  openOperation,
  readMetadata,
  runBandSelectionFormula,
  selectPanel,
  type PixelDimensions,
} from "./support/page-objects";

// CT-210: band selection reduces every band into ONE summary band opened in a
// fresh float32 panel. multiband-12bit.tif (3 bands; at pixel (0,0) band 1 = 100,
// band 2 = 800, band 3 = 1600) is the oracle: the average preset reads the mean
// 833.333 at (0,0); an inline formula returning band 2 reads 800; an imported .py
// returning the last band reads 1600. Each asserts the single-band float32 result
// and its (0,0) readout via the pixel-readout oracle.

const RESULT_PANEL = 2;
const FLOAT32 = "float32";
const DIMENSIONS: PixelDimensions = { width: multiBandTiff.width, height: multiBandTiff.height };
const FLOAT_READOUT_TOLERANCE = 0.1;
const AVERAGE_VALUE = (100 + 800 + 1600) / 3;
const BAND_TWO_VALUE = 800;
const BAND_THREE_VALUE = 1600;

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const IMPORTED_BAND_TOOL_PATH = join(currentDirectory, "fixtures", "band-tool.py");

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, 1);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("the average preset reduces the stack to the per-pixel mean band", async () => {
  await openBandSelectionEditor();
  await clickBandSelectionPreset(launched.window, "Average");
  await expectBandSelectionFunction(launched.window, "Average");
  await applyAndExpectSingleBandOutput(AVERAGE_VALUE, "average");
});

test("an inline formula returning a band applies as that band", async () => {
  await openBandSelectionEditor();
  await runBandSelectionFormula(launched.window, "cube[1]");
  await expectBandSelectionFunction(launched.window, "Formula");
  await applyAndExpectSingleBandOutput(BAND_TWO_VALUE, "Formula");
});

test("an imported .py tool returning a band applies as that band", async () => {
  await openBandSelectionEditor();
  await enqueueOpenDialogPaths(launched.window, [IMPORTED_BAND_TOOL_PATH]);
  await clickImportBandSelectionScript(launched.window);
  await expectBandSelectionFunction(launched.window, "Imported tool: band-tool.py");
  await applyAndExpectSingleBandOutput(BAND_THREE_VALUE, "Imported tool: band-tool.py");
});

async function openBandSelectionEditor(): Promise<void> {
  await openOperation(launched.window, BAND_SELECTION_OPERATION_LABEL);
  await expectBandSelectionEditorReady(launched.window);
}

async function applyAndExpectSingleBandOutput(
  expectedTopLeftValue: number,
  historyFunctionSubstring: string,
): Promise<void> {
  await applyOperation(launched.window, BAND_SELECTION_OPERATION_LABEL);
  expect(await countPanels(launched.window)).toBe(RESULT_PANEL);
  await selectPanel(launched.window, RESULT_PANEL);
  await expectResultIsSingleBandFloat32();
  await expectResultReadout(expectedTopLeftValue);
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: BAND_SELECTION_OPERATION_LABEL,
    detailSubstrings: [historyFunctionSubstring],
  });
}

async function expectResultIsSingleBandFloat32(): Promise<void> {
  await expectMetadataDataTypeAndDimensions(launched.window, {
    dataType: FLOAT32,
    width: multiBandTiff.width,
    height: multiBandTiff.height,
  });
  const metadata = await readMetadata(launched.window);
  expect(metadata.bandCount).toBe("1");
}

async function expectResultReadout(expected: number): Promise<void> {
  await expectPixelReadoutToEqual(launched.window, {
    panel: RESULT_PANEL,
    imageX: 0,
    imageY: 0,
    dimensions: DIMENSIONS,
    expected,
    tolerance: FLOAT_READOUT_TOLERANCE,
  });
}
