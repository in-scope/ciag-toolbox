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
import { writeTemporaryMultiBandUint16Tiff } from "./support/temporary-multi-band-tiff-fixture";

// CT-195: MNF noise-whitening scales each component direction by 1/sqrt(noise
// eigenvalue). On a rank-deficient-noise cube (two bands carrying independent
// signals but sharing the SAME correlated noise) that gain explodes along the
// signal-bearing noise null space, so before the fix the projected component
// values reached ~1.5e6. Float bands upload RAW values into a half-float (R16F)
// display texture whose max finite value is ~65504, so those values overflowed to
// Inf and the panel rendered uniformly WHITE - while the float DATA stayed finite,
// which is why the collinear-fixture mnf.spec never caught it. The fix rescales
// each MNF component vector to unit length, keeping the components finite, in data
// units, and well within the half-float range. This spec runs MNF on the
// reproducing fixture and asserts the output panel is NOT uniformly white/blank
// (it renders a real, non-saturated gradient) AND the readout reads finite floats.

const MNF = "MNF";
const SOURCE_PANEL = 1;
const RESULT_PANEL = 2;
const KEPT_COMPONENT_COUNT = 2;
const SIDE = 24;
const DIMENSIONS: PixelDimensions = { width: SIDE, height: SIDE };
// The overflowed component clips toward white: depending on the GPU's float16
// out-of-range handling it either saturates to Inf (a pure white panel, fraction
// ~1.0) or clamps to the largest finite half-float (~25% of pixels pinned white).
// A healthy unit-scaled gradient leaves almost nothing clipped, so this ceiling
// fails the broken render either way while passing the fix (~0.002).
const SATURATED_WHITE_CEILING = 0.08;
// A real stretched gradient spans the tonal range with many distinct shades; the
// overflowed render collapses to a narrow clipped band (a white screen has ~2
// colours, the finite-clamp case ~18). The fix renders ~200.
const GRADIENT_DISTINCT_COLOR_FLOOR = 64;
// The stretched component fills most of the panel with visible (brighter than the
// clear colour) content; the broken compressed render covers noticeably less.
const NON_CLEAR_CONTENT_FLOOR = 0.4;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadRankDeficientNoiseStack();
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("MNF on a rank-deficient-noise cube renders a real gradient, not a white screen", async () => {
  await runMnfKeepingTwoComponents();

  expect(await countPanels(launched.window)).toBe(RESULT_PANEL);
  await selectPanel(launched.window, RESULT_PANEL);
  await expectOutputPanelIsNotUniformlyWhiteOrBlank();
  await expectLeadingComponentReadsFiniteValue();
});

async function runMnfKeepingTwoComponents(): Promise<void> {
  await selectPanel(launched.window, SOURCE_PANEL);
  await openOperation(launched.window, MNF);
  await setOperationNumberParameter(launched.window, MNF, "Components", KEPT_COMPONENT_COUNT);
  await applyOperation(launched.window, MNF);
}

async function expectOutputPanelIsNotUniformlyWhiteOrBlank(): Promise<void> {
  const canvas = panelCanvas(launched.window, RESULT_PANEL);
  await expect
    .poll(async () => nonClearPixelFraction(await summarizeCanvasPixels(canvas)))
    .toBeGreaterThan(NON_CLEAR_CONTENT_FLOOR);
  expect(await saturatedWhitePixelFraction(canvas)).toBeLessThan(SATURATED_WHITE_CEILING);
  expect((await summarizeCanvasPixels(canvas)).distinctColorCount).toBeGreaterThan(
    GRADIENT_DISTINCT_COLOR_FLOOR,
  );
}

async function expectLeadingComponentReadsFiniteValue(): Promise<void> {
  const readout = await readPixelValueAt(launched.window, RESULT_PANEL, 0, 0, DIMENSIONS);
  expect(Number.isFinite(Number.parseFloat(readout.value))).toBe(true);
}

async function loadRankDeficientNoiseStack(): Promise<void> {
  const filePath = await writeTemporaryMultiBandUint16Tiff({
    width: SIDE,
    height: SIDE,
    bands: [buildHorizontalRampSharingNoise(), buildVerticalRampSharingNoise()],
  });
  await loadImageFromAbsolutePath(launched.window, filePath);
}

// The same integer noise is added to a horizontal-ramp band and a vertical-ramp
// band, so the per-direction-centred neighbour differences are identical across
// the two bands and the estimated noise covariance is singular - the case that
// blew the whitening gain up before the fix.
function sharedNoiseAt(index: number): number {
  return ((index * 7) % 3) - 1;
}

function buildHorizontalRampSharingNoise(): number[] {
  return Array.from({ length: SIDE * SIDE }, (_unused, index) => 100 + 100 * (index % SIDE) + sharedNoiseAt(index));
}

function buildVerticalRampSharingNoise(): number[] {
  return Array.from(
    { length: SIDE * SIDE },
    (_unused, index) => 100 + 80 * Math.floor(index / SIDE) + sharedNoiseAt(index),
  );
}
