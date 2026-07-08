import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperation,
  clickImportCustomTransformScript,
  countPanels,
  CUSTOM_TRANSFORM_OPERATION_LABEL,
  enqueueOpenDialogPaths,
  expectCustomTransformEditorReady,
  expectCustomTransformReady,
  expectHistoryToRecordOperation,
  expectMetadataDataTypeAndDimensions,
  expectPixelReadoutToEqual,
  loadFixtureAsStack,
  openOperation,
  readMetadata,
  runCustomTransformFormula,
  selectPanel,
  type PixelDimensions,
} from "./support/page-objects";

// CT-216: the Custom transform runs a formula or imported tool over the WHOLE
// cube and applies the returned cube as a new float32 stack in a fresh panel;
// the band count is free. multiband-12bit.tif (3 bands; at pixel (0,0) band 1 =
// 100, band 2 = 800, band 3 = 1600) is the oracle: 'cube * 2' keeps 3 bands and
// reads 200 at (0,0) on band 1; 'np.diff(cube, axis=0)' shrinks to 2 bands and
// reads 700; the imported transform-tool.py reverses the band order so band 1
// reads 1600. Each case asserts the true value via the pixel-readout oracle and
// that the result opened in a new panel.

const RESULT_PANEL = 2;
const FLOAT32 = "float32";
const DIMENSIONS: PixelDimensions = { width: multiBandTiff.width, height: multiBandTiff.height };
const FLOAT_READOUT_TOLERANCE = 0.1;
const DOUBLED_BAND_ONE_VALUE = 200;
const DIFF_BAND_ONE_VALUE = 800 - 100;
const REVERSED_BAND_ONE_VALUE = 1600;

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const IMPORTED_TRANSFORM_TOOL_PATH = join(currentDirectory, "fixtures", "transform-tool.py");

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, 1);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("a formula transforming every value applies as a same-band-count stack", async () => {
  await openCustomTransformEditor();
  await runCustomTransformFormula(launched.window, "cube * 2");
  await expectCustomTransformReady(launched.window, "Formula (3 bands)");
  await applyAndExpectTransformedOutput({
    expectedBandCount: 3,
    expectedTopLeftBandOneValue: DOUBLED_BAND_ONE_VALUE,
    historyDetailSubstring: "cube * 2",
  });
});

test("a formula changing the band count applies as a reduced stack", async () => {
  await openCustomTransformEditor();
  await runCustomTransformFormula(launched.window, "np.diff(cube, axis=0)");
  await expectCustomTransformReady(launched.window, "Formula (2 bands)");
  await applyAndExpectTransformedOutput({
    expectedBandCount: 2,
    expectedTopLeftBandOneValue: DIFF_BAND_ONE_VALUE,
    historyDetailSubstring: "np.diff(cube, axis=0)",
  });
});

test("an imported .py tool transforming the cube applies and is named in History", async () => {
  await openCustomTransformEditor();
  await enqueueOpenDialogPaths(launched.window, [IMPORTED_TRANSFORM_TOOL_PATH]);
  await clickImportCustomTransformScript(launched.window);
  await expectCustomTransformReady(launched.window, "Imported tool: transform-tool.py (3 bands)");
  await applyAndExpectTransformedOutput({
    expectedBandCount: 3,
    expectedTopLeftBandOneValue: REVERSED_BAND_ONE_VALUE,
    historyDetailSubstring: "transform-tool.py",
  });
});

async function openCustomTransformEditor(): Promise<void> {
  await openOperation(launched.window, CUSTOM_TRANSFORM_OPERATION_LABEL);
  await expectCustomTransformEditorReady(launched.window);
}

interface ExpectedTransformedOutput {
  readonly expectedBandCount: number;
  readonly expectedTopLeftBandOneValue: number;
  readonly historyDetailSubstring: string;
}

async function applyAndExpectTransformedOutput(expected: ExpectedTransformedOutput): Promise<void> {
  await applyOperation(launched.window, CUSTOM_TRANSFORM_OPERATION_LABEL);
  expect(await countPanels(launched.window)).toBe(RESULT_PANEL);
  await selectPanel(launched.window, RESULT_PANEL);
  await expectResultIsFloat32StackWithBandCount(expected.expectedBandCount);
  await expectResultReadout(expected.expectedTopLeftBandOneValue);
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: CUSTOM_TRANSFORM_OPERATION_LABEL,
    detailSubstrings: [expected.historyDetailSubstring],
  });
}

async function expectResultIsFloat32StackWithBandCount(expectedBandCount: number): Promise<void> {
  await expectMetadataDataTypeAndDimensions(launched.window, {
    dataType: FLOAT32,
    width: multiBandTiff.width,
    height: multiBandTiff.height,
  });
  const metadata = await readMetadata(launched.window);
  expect(metadata.bandCount).toBe(String(expectedBandCount));
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
