import { expect, test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperation,
  countPanels,
  expectMetadataDataTypeAndDimensions,
  loadFixtureAsStack,
  openOperation,
  readMetadata,
  readPixelValueAt,
  selectPanel,
  setOperationNumberParameter,
  type PixelDimensions,
} from "./support/page-objects";

// CT-181 / Stage 4: PCA compresses the cube into the first X principal components,
// emitted as the bands of a NEW float32 stack opened in a fresh panel (the locked
// dimension-reduction output model). The committed 3-band uint16 multiband-12bit.tif
// is the oracle: its bands are perfectly collinear (each band is the first plus a
// constant), so PC1 carries essentially all the variance and reads a large non-zero
// float at the corner pixel (where every band sits at its minimum, far off the mean).
// This spec verifies (a) a new panel opens, (b) it is float32 with the requested
// component/band count, and (c) the pixel-readout oracle reports a real component
// value rather than all zeros.

const PCA = "PCA";
const RESULT_PANEL = 2;
const FLOAT32 = "float32";
const KEPT_COMPONENT_COUNT = 2;
const DIMENSIONS: PixelDimensions = { width: multiBandTiff.width, height: multiBandTiff.height };
// PC1 at the all-minimum corner pixel is ~129 in magnitude (the mean-centred corner is
// [-75, -75, -75] projected onto the unit (1,1,1) axis), so a >1 magnitude proves the
// component carries real variance and is not a degenerate all-zero band.
const NONZERO_COMPONENT_MAGNITUDE = 1;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("PCA opens a new float32 component stack with the kept component count and real values", async () => {
  await runPcaKeepingTwoComponents();

  expect(await countPanels(launched.window)).toBe(RESULT_PANEL);
  await selectPanel(launched.window, RESULT_PANEL);
  await expectResultIsFloat32StackWithKeptComponentCount();
  await expectLeadingComponentReadsRealValue();
});

async function runPcaKeepingTwoComponents(): Promise<void> {
  await openOperation(launched.window, PCA);
  await setOperationNumberParameter(launched.window, PCA, "Components", KEPT_COMPONENT_COUNT);
  await applyOperation(launched.window, PCA);
}

async function expectResultIsFloat32StackWithKeptComponentCount(): Promise<void> {
  await expectMetadataDataTypeAndDimensions(launched.window, {
    dataType: FLOAT32,
    width: multiBandTiff.width,
    height: multiBandTiff.height,
  });
  const metadata = await readMetadata(launched.window);
  expect(metadata.bandCount).toBe(String(KEPT_COMPONENT_COUNT));
}

async function expectLeadingComponentReadsRealValue(): Promise<void> {
  const readout = await readPixelValueAt(launched.window, RESULT_PANEL, 0, 0, DIMENSIONS);
  const value = Number.parseFloat(readout.value);
  expect(Number.isFinite(value)).toBe(true);
  expect(Math.abs(value)).toBeGreaterThan(NONZERO_COMPONENT_MAGNITUDE);
}
