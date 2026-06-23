import { expect, test } from "@playwright/test";

import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperation,
  countPanels,
  loadImageFromAbsolutePath,
  openOperation,
  readPixelValueAt,
  selectOperationRegionByDrag,
  selectPanel,
  selectRegionOfInterestScope,
  setOperationNumberParameter,
  type PixelDimensions,
} from "./support/page-objects";
import { writeTemporaryMultiBandUint16Tiff } from "./support/temporary-multi-band-tiff-fixture";

// CT-182 / Stage 4: a dimension-reduction transform can be FIT on a selected ROI and
// then APPLIED to the whole cube, projecting every pixel through components derived from
// just the sub-region. This spec runs PCA two ways on the SAME stack and proves the ROI
// fit actually took effect: the whole-image fit and the ROI fit report DIFFERENT component
// values at the same sampled pixel (the pixel-readout oracle), because the ROI's per-band
// means/covariance differ from the whole image's.
//
// The fixture is a throwaway 4x4 two-band stack with INDEPENDENT structure: band 1 is a
// horizontal gradient (varies with x), band 2 a vertical gradient (varies with y). Over the
// whole image band 1 carries the most variance, so PC1 follows band 1; but the left-half ROI
// (x in 0..1) shrinks band 1's spread below band 2's, so the ROI's PC1 follows band 2 and
// re-centres on a different mean. The PC1 readout at a fixed pixel therefore changes between
// the two fits.

const PCA = "PCA";
const SIDE = 4;
const DIMENSIONS: PixelDimensions = { width: SIDE, height: SIDE };
const SOURCE_PANEL = 1;
const WHOLE_FIT_RESULT_PANEL = 2;
const ROI_FIT_RESULT_PANEL = 3;
const KEPT_COMPONENT_COUNT = 1;
const SAMPLE_PIXEL = { x: 3, y: 0 } as const;
// Whole-image PC1 at (3,0) follows band 1 (~150 in magnitude); the left-half ROI PC1 follows
// band 2 (~90). Even allowing for arbitrary eigenvector sign, the two readouts differ by far
// more than this guard, while a degenerate "ROI fit ignored" run would make them identical.
const MINIMUM_READOUT_DIFFERENCE = 20;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadIndependentStructureStackIntoSourcePanel();
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("PCA fit on an ROI projects the whole cube differently than a whole-image fit", async () => {
  const wholeFitValue = await runPcaOnWholeImageAndReadSampleComponent();
  const roiFitValue = await runPcaFitOnLeftHalfRoiAndReadSampleComponent();

  expect(Number.isFinite(wholeFitValue)).toBe(true);
  expect(Number.isFinite(roiFitValue)).toBe(true);
  expect(Math.abs(wholeFitValue - roiFitValue)).toBeGreaterThan(MINIMUM_READOUT_DIFFERENCE);
});

async function runPcaOnWholeImageAndReadSampleComponent(): Promise<number> {
  await selectPanel(launched.window, SOURCE_PANEL);
  await openOperation(launched.window, PCA);
  await setOperationNumberParameter(launched.window, PCA, "Components", KEPT_COMPONENT_COUNT);
  await applyOperation(launched.window, PCA);
  expect(await countPanels(launched.window)).toBe(WHOLE_FIT_RESULT_PANEL);
  return readLeadingComponentAt(WHOLE_FIT_RESULT_PANEL);
}

async function runPcaFitOnLeftHalfRoiAndReadSampleComponent(): Promise<number> {
  await selectPanel(launched.window, SOURCE_PANEL);
  await openOperation(launched.window, PCA);
  await setOperationNumberParameter(launched.window, PCA, "Components", KEPT_COMPONENT_COUNT);
  await selectRegionOfInterestScope(launched.window, PCA);
  await selectLeftHalfFitRegion();
  await applyOperation(launched.window, PCA);
  expect(await countPanels(launched.window)).toBe(ROI_FIT_RESULT_PANEL);
  return readLeadingComponentAt(ROI_FIT_RESULT_PANEL);
}

async function selectLeftHalfFitRegion(): Promise<void> {
  await selectOperationRegionByDrag(launched.window, {
    panelNumber: SOURCE_PANEL,
    operationLabel: PCA,
    startPixel: { x: 0, y: 0 },
    endPixel: { x: 1, y: SIDE - 1 },
    imageDimensions: DIMENSIONS,
  });
}

async function readLeadingComponentAt(panelNumber: number): Promise<number> {
  const readout = await readPixelValueAt(
    launched.window,
    panelNumber,
    SAMPLE_PIXEL.x,
    SAMPLE_PIXEL.y,
    DIMENSIONS,
  );
  return Number.parseFloat(readout.value);
}

async function loadIndependentStructureStackIntoSourcePanel(): Promise<void> {
  const filePath = await writeTemporaryMultiBandUint16Tiff({
    width: SIDE,
    height: SIDE,
    bands: [buildHorizontalGradientBand(), buildVerticalGradientBand()],
  });
  await loadImageFromAbsolutePath(launched.window, filePath);
}

function buildHorizontalGradientBand(): number[] {
  return Array.from({ length: SIDE * SIDE }, (_unused, index) => 100 + (index % SIDE) * 100);
}

function buildVerticalGradientBand(): number[] {
  return Array.from({ length: SIDE * SIDE }, (_unused, index) => 100 + Math.floor(index / SIDE) * 60);
}
