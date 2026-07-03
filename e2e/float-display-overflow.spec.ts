import { expect, test } from "@playwright/test";

import {
  nonClearPixelFraction,
  saturatedWhitePixelFraction,
  summarizeCanvasPixels,
} from "./support/canvas-pixels";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperation,
  countPanels,
  loadImageFromAbsolutePath,
  openOperation,
  panelCanvas,
  readPixelValueAt,
  selectPanel,
  setOperationNumberParameter,
  type PixelDimensions,
} from "./support/page-objects";
import { writeTemporaryMultiBandFloat32Tiff } from "./support/temporary-multi-band-float32-tiff-fixture";
import { writeTemporaryMultiBandUint16Tiff } from "./support/temporary-multi-band-tiff-fixture";

// Field regression (venere.hdr PCA report): PCA on a raw-DN uint16 hyperspectral
// cube concentrates ~99% of the variance in PC 1, whose projected float values
// reach the +-hundreds of thousands. Float bands upload RAW values into the
// display texture, so half-float (R16F) storage overflows above ~65504 and the
// auto-stretched render collapses: overflow-to-Inf GPUs binarize the panel to
// pure black/white, clamping GPUs (ANGLE/SwiftShader here) pin the overflowed
// pixels to two flat grays. Either way most of the tonal gradient disappears,
// while the float32 DATA stays correct (the readout still reports true values).
// The fix stores float tiles in full float32 (R32F), so the shader samples the
// exact data values and the stretch renders the whole gradient.
//
// Oracle: canvas-pixel sampling. The distinct-color floor is the discriminator
// that bites under BOTH overflow behaviours (a binarized panel has ~2 colors, a
// clamped one collapses to a narrow band); the saturated-white ceiling
// additionally bites the Inf case, and the non-clear floor rejects blank panels.
// Each test first asserts through the pixel readout that the panel's data really
// does exceed the half-float limit, so a fixture drift cannot pass vacuously.

const SIDE = 24;
const PIXEL_COUNT = SIDE * SIDE;
const DIMENSIONS: PixelDimensions = { width: SIDE, height: SIDE };
const HALF_FLOAT_MAX_FINITE_VALUE = 65504;

// A healthy stretched ramp renders ~200+ distinct shades; the broken render
// keeps only the slice of values inside +-65504 (well under 64 shades for these
// fixtures) plus two pinned levels, or just black/white on Inf GPUs.
const GRADIENT_DISTINCT_COLOR_FLOOR = 64;
// A stretched ramp saturates only its top sliver (~2%); an Inf-overflowed panel
// slams roughly half the image to pure white.
const SATURATED_WHITE_CEILING = 0.08;
// The stretched image fills most of the panel with visible content.
const NON_CLEAR_CONTENT_FLOOR = 0.4;

// The float display fixture mirrors the venere PC 1 value range.
const FLOAT_RAMP_MIN = -500_000;
const FLOAT_RAMP_MAX = 800_000;

// The dimension-reduction fixture: BAND_COUNT near-identical full-range uint16
// ramp bands. The leading component direction is ~(1,..,1)/sqrt(N), so its
// projection reaches ~sqrt(N) * 32767 (~393k for 144 bands), six times past the
// half-float limit. Per-band deterministic noise keeps the MNF noise covariance
// non-singular; it is negligible for PCA.
const BAND_COUNT = 144;

const PCA = "PCA";
const MNF = "MNF";
const COMPONENTS_PARAMETER = "Components";
const KEPT_COMPONENT_COUNT = 1;
const SOURCE_PANEL = 1;
const RESULT_PANEL = 2;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("a float band far beyond the half-float range still renders its full gradient", async () => {
  await loadSingleBandFloatRampBeyondHalfFloatRange();

  await expectPixelDataExceedsHalfFloatRange(SOURCE_PANEL);
  await expectPanelRendersFullGradient(SOURCE_PANEL);
});

test("PCA's leading component on a raw-DN uint16 cube renders its full gradient", async () => {
  await loadCorrelatedFullRangeUint16Stack();
  await runDimensionReductionKeepingOneComponent(PCA);

  expect(await countPanels(launched.window)).toBe(RESULT_PANEL);
  await selectPanel(launched.window, RESULT_PANEL);
  await expectPixelDataExceedsHalfFloatRange(RESULT_PANEL);
  await expectPanelRendersFullGradient(RESULT_PANEL);
});

test("MNF's leading component on a raw-DN uint16 cube renders its full gradient", async () => {
  await loadCorrelatedFullRangeUint16Stack();
  await runDimensionReductionKeepingOneComponent(MNF);

  expect(await countPanels(launched.window)).toBe(RESULT_PANEL);
  await selectPanel(launched.window, RESULT_PANEL);
  await expectPixelDataExceedsHalfFloatRange(RESULT_PANEL);
  await expectPanelRendersFullGradient(RESULT_PANEL);
});

async function runDimensionReductionKeepingOneComponent(operationName: string): Promise<void> {
  await selectPanel(launched.window, SOURCE_PANEL);
  await openOperation(launched.window, operationName);
  await setOperationNumberParameter(
    launched.window,
    operationName,
    COMPONENTS_PARAMETER,
    KEPT_COMPONENT_COUNT,
  );
  await applyOperation(launched.window, operationName);
}

// The origin pixel sits at the ramp's extreme, so its true value exceeds the
// half-float limit by construction. Reading it through the data oracle proves
// the fixture really exercises the overflow (no vacuous pass) AND that the
// underlying float data is intact regardless of how the display renders.
async function expectPixelDataExceedsHalfFloatRange(panelNumber: number): Promise<void> {
  const readout = await readPixelValueAt(launched.window, panelNumber, 0, 0, DIMENSIONS);
  const value = Number.parseFloat(readout.value);
  expect(Number.isFinite(value)).toBe(true);
  expect(Math.abs(value)).toBeGreaterThan(HALF_FLOAT_MAX_FINITE_VALUE);
}

async function expectPanelRendersFullGradient(panelNumber: number): Promise<void> {
  const canvas = panelCanvas(launched.window, panelNumber);
  await expect
    .poll(async () => nonClearPixelFraction(await summarizeCanvasPixels(canvas)))
    .toBeGreaterThan(NON_CLEAR_CONTENT_FLOOR);
  expect(await saturatedWhitePixelFraction(canvas)).toBeLessThan(SATURATED_WHITE_CEILING);
  expect((await summarizeCanvasPixels(canvas)).distinctColorCount).toBeGreaterThan(
    GRADIENT_DISTINCT_COLOR_FLOOR,
  );
}

async function loadSingleBandFloatRampBeyondHalfFloatRange(): Promise<void> {
  const filePath = await writeTemporaryMultiBandFloat32Tiff({
    width: SIDE,
    height: SIDE,
    bands: [buildFloatRampBand()],
  });
  await loadImageFromAbsolutePath(launched.window, filePath);
}

function buildFloatRampBand(): number[] {
  const span = FLOAT_RAMP_MAX - FLOAT_RAMP_MIN;
  return Array.from(
    { length: PIXEL_COUNT },
    (_unused, index) => FLOAT_RAMP_MIN + (span * index) / (PIXEL_COUNT - 1),
  );
}

async function loadCorrelatedFullRangeUint16Stack(): Promise<void> {
  const filePath = await writeTemporaryMultiBandUint16Tiff({
    width: SIDE,
    height: SIDE,
    bands: Array.from({ length: BAND_COUNT }, (_unused, bandIndex) =>
      buildFullRangeRampBandWithNoise(bandIndex),
    ),
  });
  await loadImageFromAbsolutePath(launched.window, filePath);
}

function buildFullRangeRampBandWithNoise(bandIndex: number): number[] {
  return Array.from({ length: PIXEL_COUNT }, (_unused, pixelIndex) =>
    clampToUint16(fullRangeRampAt(pixelIndex) + deterministicNoiseAt(bandIndex, pixelIndex)),
  );
}

function fullRangeRampAt(pixelIndex: number): number {
  return Math.round((65535 * pixelIndex) / (PIXEL_COUNT - 1));
}

function deterministicNoiseAt(bandIndex: number, pixelIndex: number): number {
  return ((pixelIndex * (bandIndex + 3)) % 7) - 3;
}

function clampToUint16(value: number): number {
  return Math.min(65535, Math.max(0, value));
}
