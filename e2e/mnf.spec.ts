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

// CT-183 / Stage 4: MNF orders the cube by signal-to-noise rather than variance
// and emits the first X minimum-noise-fraction components as the bands of a NEW
// float32 stack opened in a fresh panel (the locked dimension-reduction output
// model). The committed 3-band uint16 multiband-12bit.tif is the oracle: its
// bands are collinear, so the noise covariance is singular and the regularized
// whitening must still produce a real, non-zero leading component at the
// all-minimum corner pixel (far from the band means). This spec verifies (a) a
// new panel opens, (b) it is float32 with the requested component/band count, and
// (c) the pixel-readout oracle reports a real component value rather than zero.

const MNF = "MNF";
const RESULT_PANEL = 2;
const FLOAT32 = "float32";
const KEPT_COMPONENT_COUNT = 2;
const DIMENSIONS: PixelDimensions = { width: multiBandTiff.width, height: multiBandTiff.height };
// The noise-whitened leading component still carries the corner pixel's large
// deviation from the band means, so a clearly non-zero magnitude proves the
// component is real data and not a degenerate all-zero band.
const NONZERO_COMPONENT_MAGNITUDE = 1e-3;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("MNF opens a new float32 component stack with the kept component count and real values", async () => {
  await runMnfKeepingTwoComponents();

  expect(await countPanels(launched.window)).toBe(RESULT_PANEL);
  await selectPanel(launched.window, RESULT_PANEL);
  await expectResultIsFloat32StackWithKeptComponentCount();
  await expectLeadingComponentReadsRealValue();
});

async function runMnfKeepingTwoComponents(): Promise<void> {
  await openOperation(launched.window, MNF);
  await setOperationNumberParameter(launched.window, MNF, "Components", KEPT_COMPONENT_COUNT);
  await applyOperation(launched.window, MNF);
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
