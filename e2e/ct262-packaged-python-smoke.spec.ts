import { expect, test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperation,
  BAND_SELECTION_OPERATION_LABEL,
  countPanels,
  expectBandSelectionEditorReady,
  expectBandSelectionFunction,
  expectPixelReadoutToEqual,
  loadFixtureAsStack,
  openOperation,
  runBandSelectionFormula,
  selectPanel,
} from "./support/page-objects";

// CT-262 packaged-build smoke: proves an INSTALLED (or unpacked) build resolves
// its bundled Python runtime under process.resourcesPath by running a
// band-selection formula end to end. Opt-in because it needs a packed build:
//   pnpm build:win   (afterPack already verifies the runtime files are packed)
//   $env:MSI_PACKAGED_APP_EXE = "<install dir>\MSI Toolbox.exe"; pnpm e2e ct262
// No dev server is needed; the packaged renderer is self-contained.
// Oracle: multiband-12bit.tif, formula cube[1] -> band 2's value 800 at (0,0)
// via the pixel-readout oracle. A missing packed runtime fails the formula run
// with PythonInterpreterNotFoundError, so a passing run is direct evidence the
// packaged resolver + packaging pipeline work together.

const packagedExecutablePath = process.env["MSI_PACKAGED_APP_EXE"];

const RESULT_PANEL = 2;
const BAND_TWO_VALUE = 800;
const FLOAT_READOUT_TOLERANCE = 0.1;

test.skip(
  packagedExecutablePath === undefined,
  "Set MSI_PACKAGED_APP_EXE to an installed MSI Toolbox executable to run the packaged smoke",
);

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp({ packagedExecutablePath });
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, 1);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("the installed build runs a band-selection formula through its bundled Python runtime", async () => {
  await openOperation(launched.window, BAND_SELECTION_OPERATION_LABEL);
  await expectBandSelectionEditorReady(launched.window);
  await runBandSelectionFormula(launched.window, "cube[1]");
  await expectBandSelectionFunction(launched.window, "Formula");
  await applyOperation(launched.window, BAND_SELECTION_OPERATION_LABEL);
  expect(await countPanels(launched.window)).toBe(RESULT_PANEL);
  await selectPanel(launched.window, RESULT_PANEL);
  await expectPixelReadoutToEqual(launched.window, {
    panel: RESULT_PANEL,
    imageX: 0,
    imageY: 0,
    dimensions: { width: multiBandTiff.width, height: multiBandTiff.height },
    expected: BAND_TWO_VALUE,
    tolerance: FLOAT_READOUT_TOLERANCE,
  });
});
