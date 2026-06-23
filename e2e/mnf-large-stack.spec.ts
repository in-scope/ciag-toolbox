import { expect, test } from "@playwright/test";

import {
  nonClearPixelFraction,
  summarizeCanvasPixels,
} from "./support/canvas-pixels";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applicationToolbar,
  applyOperation,
  countPanels,
  loadImageFromAbsolutePath,
  openOperation,
  panelCanvas,
  readMetadata,
  readPixelValueAt,
  selectPanel,
  setOperationNumberParameter,
  type PixelDimensions,
} from "./support/page-objects";
import { writeTemporaryMultiBandUint16Tiff } from "./support/temporary-multi-band-tiff-fixture";

// CT-195: on a real ~100-megapixel stack, MNF crashed the WHOLE renderer (a
// uniform white screen: toolbar, panels and the right rail all vanished). The
// cause was the shift-difference noise estimate allocating one [number, number]
// tuple object per neighbour pair (~100 million per direction) plus several
// full-length difference arrays per band, exhausting the renderer heap. The fix
// streams the noise covariance over neighbour pairs by index arithmetic, holding
// only band-count-square accumulators. The tiny committed fixtures never bit this,
// so this spec runs MNF on a LARGE generated stack (well beyond the 4x4 / 24x24
// fixtures, with real per-pixel counts) and asserts the app is STILL ALIVE
// afterwards: the application toolbar is present, a real float32 component panel
// opened, the canvas renders visible content, and the readout reads finite floats.
// A pre-fix renderer white-screen would fail every one of these.

const MNF = "MNF";
const SOURCE_PANEL = 1;
const RESULT_PANEL = 2;
const FLOAT32 = "float32";
const KEPT_COMPONENT_COUNT = 2;
const LARGE_SIDE = 512;
const DIMENSIONS: PixelDimensions = { width: LARGE_SIDE, height: LARGE_SIDE };
// A healthy MNF component fills most of the panel with visible (brighter than the
// clear colour) content; a crashed/blank renderer would not.
const NON_CLEAR_CONTENT_FLOOR = 0.4;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadLargeFourBandStack();
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("MNF on a large stack keeps the renderer alive and opens a real component panel", async () => {
  await runMnfKeepingTwoComponents();

  await expectApplicationStillAlive();
  expect(await countPanels(launched.window)).toBe(RESULT_PANEL);
  await selectPanel(launched.window, RESULT_PANEL);
  await expectResultIsFloat32StackWithKeptComponentCount();
  await expectComponentPanelRendersVisibleContent();
  await expectLeadingComponentReadsFiniteValue();
});

async function runMnfKeepingTwoComponents(): Promise<void> {
  await selectPanel(launched.window, SOURCE_PANEL);
  await openOperation(launched.window, MNF);
  await setOperationNumberParameter(launched.window, MNF, "Components", KEPT_COMPONENT_COUNT);
  await applyOperation(launched.window, MNF);
}

async function expectApplicationStillAlive(): Promise<void> {
  await expect(applicationToolbar(launched.window)).toBeVisible();
}

async function expectResultIsFloat32StackWithKeptComponentCount(): Promise<void> {
  const metadata = await readMetadata(launched.window);
  expect(metadata.dataType).toBe(FLOAT32);
  expect(metadata.bandCount).toBe(String(KEPT_COMPONENT_COUNT));
}

async function expectComponentPanelRendersVisibleContent(): Promise<void> {
  const canvas = panelCanvas(launched.window, RESULT_PANEL);
  await expect
    .poll(async () => nonClearPixelFraction(await summarizeCanvasPixels(canvas)))
    .toBeGreaterThan(NON_CLEAR_CONTENT_FLOOR);
}

async function expectLeadingComponentReadsFiniteValue(): Promise<void> {
  const readout = await readPixelValueAt(launched.window, RESULT_PANEL, 0, 0, DIMENSIONS);
  expect(Number.isFinite(Number.parseFloat(readout.value))).toBe(true);
}

async function loadLargeFourBandStack(): Promise<void> {
  const filePath = await writeTemporaryMultiBandUint16Tiff({
    width: LARGE_SIDE,
    height: LARGE_SIDE,
    bands: [horizontalRampBand(), verticalRampBand(), diagonalRampBand(), texturedBand()],
  });
  await loadImageFromAbsolutePath(launched.window, filePath);
}

// Each band carries an independent spatial signal plus its own deterministic
// per-pixel noise, so MNF estimates a non-singular noise covariance and emits
// real signal-bearing components rather than degenerate null bands.
function noiseAt(seed: number, index: number): number {
  return (((index * (seed + 3)) % 7) - 3) * 4;
}

function horizontalRampBand(): number[] {
  return Array.from({ length: LARGE_SIDE * LARGE_SIDE }, (_unused, i) => 1000 + (i % LARGE_SIDE) + noiseAt(1, i));
}

function verticalRampBand(): number[] {
  return Array.from(
    { length: LARGE_SIDE * LARGE_SIDE },
    (_unused, i) => 1000 + Math.floor(i / LARGE_SIDE) + noiseAt(2, i),
  );
}

function diagonalRampBand(): number[] {
  return Array.from(
    { length: LARGE_SIDE * LARGE_SIDE },
    (_unused, i) => 1000 + ((i % LARGE_SIDE) + Math.floor(i / LARGE_SIDE)) + noiseAt(5, i),
  );
}

function texturedBand(): number[] {
  return Array.from(
    { length: LARGE_SIDE * LARGE_SIDE },
    (_unused, i) => 1000 + (((i % LARGE_SIDE) * Math.floor(i / LARGE_SIDE)) % 200) + noiseAt(11, i),
  );
}
