import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperation,
  BAND_WEIGHTING_OPERATION_LABEL,
  clickImportBandWeightingScript,
  clickResetAllWeightsToOne,
  countPanels,
  enqueueOpenDialogPaths,
  expectBandWeightFieldsToEqual,
  expectBandWeightingEditorReady,
  expectHistoryToRecordOperation,
  expectMetadataDataTypeAndDimensions,
  expectPixelReadoutToEqual,
  loadFixtureAsStack,
  openOperation,
  readMetadata,
  runBandWeightingFormula,
  selectPanel,
  setBandWeightField,
  type PixelDimensions,
} from "./support/page-objects";

// CT-209: band weighting combines every band into ONE weighted-sum image opened
// in a fresh float32 panel. multiband-12bit.tif (3 bands, band 1 = 100, band 2 =
// 800, band 3 = 1600 at pixel (0,0)) is the oracle: weighting a single band with 1
// (normalizer 1) yields that band's value exactly at (0,0). Three input paths are
// covered - hand weights (reset-all-to-1 then zero the others), an inline formula
// returning weights, and an imported .py returning weights - each populates the
// editable weight fields and applies to the same asserted output.

const RESULT_PANEL = 2;
const FLOAT32 = "float32";
const DIMENSIONS: PixelDimensions = { width: multiBandTiff.width, height: multiBandTiff.height };
const FLOAT_READOUT_TOLERANCE = 0.001;
const BAND_ONE_VALUE = 100;
const BAND_TWO_VALUE = 800;
const BAND_THREE_VALUE = 1600;

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const IMPORTED_WEIGHTS_TOOL_PATH = join(currentDirectory, "fixtures", "weights-tool.py");

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, 1);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("hand-set weights (reset-all-to-1) apply as the normalized weighted sum", async () => {
  await openBandWeightingEditor();
  await clickResetAllWeightsToOne(launched.window);
  await setBandWeightField(launched.window, 2, 0);
  await setBandWeightField(launched.window, 3, 0);
  await expectBandWeightFieldsToEqual(launched.window, ["1", "0", "0"]);
  await applyAndExpectSingleBandOutput(BAND_ONE_VALUE, "weights: 1, 0, 0");
});

test("an inline formula returning weights populates the fields and applies", async () => {
  await openBandWeightingEditor();
  await runBandWeightingFormula(launched.window, "[0, 1, 0]");
  await expectBandWeightFieldsToEqual(launched.window, ["0", "1", "0"]);
  await applyAndExpectSingleBandOutput(BAND_TWO_VALUE, "weights: 0, 1, 0");
});

test("an imported .py tool returning weights populates the fields and applies", async () => {
  await openBandWeightingEditor();
  await enqueueOpenDialogPaths(launched.window, [IMPORTED_WEIGHTS_TOOL_PATH]);
  await clickImportBandWeightingScript(launched.window);
  await expectBandWeightFieldsToEqual(launched.window, ["0", "0", "1"]);
  await applyAndExpectSingleBandOutput(BAND_THREE_VALUE, "weights: 0, 0, 1");
});

async function openBandWeightingEditor(): Promise<void> {
  await openOperation(launched.window, BAND_WEIGHTING_OPERATION_LABEL);
  await expectBandWeightingEditorReady(launched.window);
}

async function applyAndExpectSingleBandOutput(
  expectedTopLeftValue: number,
  historyWeightsSubstring: string,
): Promise<void> {
  await applyOperation(launched.window, BAND_WEIGHTING_OPERATION_LABEL);
  expect(await countPanels(launched.window)).toBe(RESULT_PANEL);
  await selectPanel(launched.window, RESULT_PANEL);
  await expectResultIsSingleBandFloat32();
  await expectResultReadout(expectedTopLeftValue);
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: BAND_WEIGHTING_OPERATION_LABEL,
    detailSubstrings: [historyWeightsSubstring],
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
