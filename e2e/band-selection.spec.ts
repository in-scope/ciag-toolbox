import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyBandSelectionFunction,
  BAND_SELECTION_OPERATION_LABEL,
  bandSelectionFormulaField,
  bandSelectionFunctionSegment,
  clickBandSelectionPreset,
  countPanels,
  enqueueOpenDialogPaths,
  enterBandSelectionFormula,
  expectBandSelectionToolLoaded,
  expectHistoryToRecordOperation,
  expectMetadataDataTypeAndDimensions,
  expectPixelReadoutToEqual,
  importBandSelectionScript,
  importBandSelectionScriptButton,
  loadFixtureAsStack,
  openBandSelectionFunctionEditor,
  readMetadata,
  selectPanel,
  subsetBandsKeepCheckboxes,
  type PixelDimensions,
} from "./support/page-objects";

// CT-210/CT-284/CT-293: deriving a band by a function lives in the Subset Bands
// editor's "By function" mode, where Average / Variance / Custom are ONE
// exclusive choice and every one of them runs at Apply.
// multiband-12bit.tif (3 bands; at pixel (0,0) band 1 = 100, band 2 = 800,
// band 3 = 1600) is the oracle: the variance preset reads the population
// variance 375555.56 at (0,0); a custom formula returning band 2 reads 800; an
// imported .py returning the last band reads 1600. Each asserts the single-band
// float32 result and its (0,0) readout via the pixel-readout oracle, and
// History keeps the pre-merge "Band Selection" vocabulary.

const RESULT_PANEL = 2;
const FLOAT32 = "float32";
const DIMENSIONS: PixelDimensions = { width: multiBandTiff.width, height: multiBandTiff.height };
const FLOAT_READOUT_TOLERANCE = 0.1;
const BAND_VALUES_AT_ORIGIN = [100, 800, 1600];
const MEAN_AT_ORIGIN = BAND_VALUES_AT_ORIGIN.reduce((a, b) => a + b, 0) / BAND_VALUES_AT_ORIGIN.length;
const VARIANCE_AT_ORIGIN =
  BAND_VALUES_AT_ORIGIN.reduce((total, value) => total + (value - MEAN_AT_ORIGIN) ** 2, 0) /
  BAND_VALUES_AT_ORIGIN.length;
// The status bar renders floats at FOUR significant figures, so a value this
// large reads back as 375600; the tolerance is that display granularity.
const VARIANCE_DISPLAY_TOLERANCE = 50;
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

test("the By function mode replaces the keep-bands controls inside the editor", async () => {
  await openBandSelectionFunctionEditor(launched.window);
  await expect(subsetBandsKeepCheckboxes(launched.window)).toHaveCount(0);
});

test("the three functions are one exclusive choice and only Custom reveals the script controls", async () => {
  await openBandSelectionFunctionEditor(launched.window);
  await expect(bandSelectionFormulaField(launched.window)).toBeHidden();
  await expect(importBandSelectionScriptButton(launched.window)).toBeHidden();
  await bandSelectionFunctionSegment(launched.window, "Custom").click();
  await expect(bandSelectionFormulaField(launched.window)).toBeVisible();
  await expect(importBandSelectionScriptButton(launched.window)).toBeVisible();
  await expect(bandSelectionFunctionSegment(launched.window, "Average")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await clickBandSelectionPreset(launched.window, "Variance");
  await expect(bandSelectionFormulaField(launched.window)).toBeHidden();
  await expect(bandSelectionFunctionSegment(launched.window, "Custom")).toHaveAttribute(
    "aria-checked",
    "false",
  );
});

test("the variance preset reduces the stack to the per-pixel population variance band", async () => {
  await openBandSelectionFunctionEditor(launched.window);
  await clickBandSelectionPreset(launched.window, "Variance");
  await applyAndExpectSingleBandOutput(VARIANCE_AT_ORIGIN, "variance", VARIANCE_DISPLAY_TOLERANCE);
});

test("a custom formula runs at Apply and applies as the band it returns", async () => {
  await openBandSelectionFunctionEditor(launched.window);
  await enterBandSelectionFormula(launched.window, "cube[1]");
  await applyAndExpectSingleBandOutput(BAND_TWO_VALUE, "Formula");
});

test("an imported .py tool runs at Apply and applies as the band it returns", async () => {
  await openBandSelectionFunctionEditor(launched.window);
  await enqueueOpenDialogPaths(launched.window, [IMPORTED_BAND_TOOL_PATH]);
  await importBandSelectionScript(launched.window);
  await expectBandSelectionToolLoaded(launched.window, "band-tool.py");
  await applyAndExpectSingleBandOutput(BAND_THREE_VALUE, "Imported tool: band-tool.py");
});

async function applyAndExpectSingleBandOutput(
  expectedTopLeftValue: number,
  historyFunctionSubstring: string,
  tolerance: number = FLOAT_READOUT_TOLERANCE,
): Promise<void> {
  await applyBandSelectionFunction(launched.window);
  expect(await countPanels(launched.window)).toBe(RESULT_PANEL);
  await selectPanel(launched.window, RESULT_PANEL);
  await expectResultIsSingleBandFloat32();
  await expectResultReadout(expectedTopLeftValue, tolerance);
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

async function expectResultReadout(expected: number, tolerance: number): Promise<void> {
  await expectPixelReadoutToEqual(launched.window, {
    panel: RESULT_PANEL,
    imageX: 0,
    imageY: 0,
    dimensions: DIMENSIONS,
    expected,
    tolerance,
  });
}
