import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyBandSelectionFunction,
  BAND_SELECTION_OPERATION_LABEL,
  countPanels,
  enqueueOpenDialogPaths,
  expectBandSelectionToolLoaded,
  expectHistoryToRecordOperation,
  expectMetadataDataTypeAndDimensions,
  expectPixelReadoutToEqual,
  importBandSelectionScript,
  loadFixtureAsStack,
  openBandSelectionFunctionEditor,
  readMetadata,
  selectPanel,
  type PixelDimensions,
} from "./support/page-objects";

// CT-213: the documented "write a script with imports" flow (the scripting guide,
// now docs/python-scripting.md, tells users to write `import numpy as np`) was never exercised end to end - both
// existing e2e fixtures (band-tool.py, weights-tool.py) contain zero imports. This
// spec drives numpy-band-tool.py, which does an explicit `import numpy as np` and
// returns np.mean(cube, axis=0), through the REAL Import script... flow of band
// selection (CT-293: the tool is re-read from disk and run AT Apply) (UI -> IPC -> bundled-mode subprocess -> sandbox, sandbox: true by
// default for imported tools). On multiband-12bit.tif (3 bands; at (0,0) band 1 =
// 100, band 2 = 800, band 3 = 1600) the per-pixel mean reads 833.333 at (0,0), a
// value distinct from any single band, asserted via the pixel-readout oracle.

const RESULT_PANEL = 2;
const FLOAT32 = "float32";
const DIMENSIONS: PixelDimensions = { width: multiBandTiff.width, height: multiBandTiff.height };
const FLOAT_READOUT_TOLERANCE = 0.1;
const PER_PIXEL_MEAN_VALUE = (100 + 800 + 1600) / 3;

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const IMPORTED_NUMPY_TOOL_PATH = join(currentDirectory, "fixtures", "numpy-band-tool.py");

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, 1);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("an imported tool that imports numpy computes its band under the sandbox", async () => {
  await openBandSelectionFunctionEditor(launched.window);
  await enqueueOpenDialogPaths(launched.window, [IMPORTED_NUMPY_TOOL_PATH]);
  await importBandSelectionScript(launched.window);
  await expectBandSelectionToolLoaded(launched.window, "numpy-band-tool.py");
  await applyAndExpectPerPixelMeanBand();
});

async function applyAndExpectPerPixelMeanBand(): Promise<void> {
  await applyBandSelectionFunction(launched.window);
  expect(await countPanels(launched.window)).toBe(RESULT_PANEL);
  await selectPanel(launched.window, RESULT_PANEL);
  await expectResultIsSingleBandFloat32();
  await expectResultReadout(PER_PIXEL_MEAN_VALUE);
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: BAND_SELECTION_OPERATION_LABEL,
    detailSubstrings: ["Imported tool: numpy-band-tool.py"],
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
