import { expect, test } from "@playwright/test";
import { join } from "node:path";

import { lowContrastGrayPng } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperation,
  createTemporaryProjectBundleDirectory,
  dragThresholdBoundHandleToFraction,
  expectHistoryToRecordOperation,
  expectMetadataDataTypeAndDimensions,
  expectPixelReadoutToEqual,
  expectThresholdEditorReady,
  historyEntryCount,
  loadFixtureAsStack,
  openOperation,
  openProjectBundleThroughOpenDialog,
  panelCanvas,
  releaseThresholdBoundDrag,
  saturatedWhitePixelFraction,
  saveProjectBundleThroughSaveDialog,
  selectPanel,
  setThresholdBoundField,
  THRESHOLD_OPERATION_LABEL,
} from "./support/page-objects";
import type { PixelDimensions } from "./support/page-objects";

// CT-200: manual threshold with live preview and binary-stack output.
// low-contrast-gray.png is a 4x4 uint8 ramp value(index) = 100 + 2*index
// (100..130). The histogram (and so the bounds range) spans the uint8 TYPE
// range 0..255, so the default bounds are [0, 255] (everything in-range).
// The threshold preview is DISPLAY-ONLY (the locked Stage 5 exception):
// opening the panel previews every pixel white, and dragging the upper bound
// to ~45% of the axis (~115) turns the upper half of the ramp black - all
// while the pixel-readout DATA stays at the source values and History stays
// empty. Apply emits a NEW 2-level 8-bit stack in a fresh panel whose
// readouts are exactly 0 / 255, records the bounds + scope in History, and
// survives a project save/load round-trip.

const SOURCE_PANEL = 1;
const RESULT_PANEL = 2;
const FIXTURE = lowContrastGrayPng;
const DIMENSIONS: PixelDimensions = { width: FIXTURE.width, height: FIXTURE.height };
const TOP_LEFT_RAW_VALUE = 100;
const BOTTOM_RIGHT_RAW_VALUE = 130;
const DEFAULT_LOWER_BOUND = 0;
const UPPER_BOUND = 114;
const HALF_RAMP_DRAG_FRACTION = 0.45;
const WHITE = 255;
const BLACK = 0;
const FULL_RANGE_WHITE_FRACTION_FLOOR = 0.2;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, FIXTURE.fileName);
  await selectPanel(launched.window, SOURCE_PANEL);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("dragging a bound previews the binary result live while the data stays unchanged", async () => {
  const beforeOpenWhite = await sourcePanelWhiteFraction();
  expect(beforeOpenWhite).toBeLessThan(0.05);
  await openThresholdEditor();
  const fullRangeWhite = await expectFullRangeBoundsPreviewAllWhite();
  await dragThresholdBoundHandleToFraction(launched.window, "Upper", HALF_RAMP_DRAG_FRACTION);
  await expectWhiteFractionDroppedBelow(fullRangeWhite * 0.75);
  await releaseThresholdBoundDrag(launched.window);
  await expectSourceReadout(0, 0, TOP_LEFT_RAW_VALUE);
  await expectSourceReadout(3, 3, BOTTOM_RIGHT_RAW_VALUE);
  expect(await historyEntryCount(launched.window)).toBe(0);
});

test("Apply produces a binary stack in a new panel reading exactly the two levels", async () => {
  await openThresholdEditor();
  await setThresholdBoundField(launched.window, "Upper", UPPER_BOUND);
  await expectSourceReadout(0, 0, TOP_LEFT_RAW_VALUE);
  await applyOperation(launched.window, THRESHOLD_OPERATION_LABEL);
  await expectBinaryResultPanelReadouts();
  await expectSourceReadout(0, 0, TOP_LEFT_RAW_VALUE);
  await expectMetadataDataTypeAndDimensions(launched.window, {
    dataType: "uint8",
    width: FIXTURE.width,
    height: FIXTURE.height,
  });
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: THRESHOLD_OPERATION_LABEL,
    detailSubstrings: [`[${DEFAULT_LOWER_BOUND}, ${UPPER_BOUND}]`, "band-wise"],
  });
});

test("the applied binary stack round-trips through project save and load", async () => {
  await openThresholdEditor();
  await setThresholdBoundField(launched.window, "Upper", UPPER_BOUND);
  await applyOperation(launched.window, THRESHOLD_OPERATION_LABEL);
  await expectBinaryResultPanelReadouts();
  await saveThenReopenProjectBundle();
  await expectBinaryResultPanelReadouts();
});

async function openThresholdEditor(): Promise<void> {
  await openOperation(launched.window, THRESHOLD_OPERATION_LABEL);
  await expectThresholdEditorReady(launched.window);
}

async function sourcePanelWhiteFraction(): Promise<number> {
  return saturatedWhitePixelFraction(panelCanvas(launched.window, SOURCE_PANEL));
}

// The default bounds span the band's full value range, so every pixel is
// in-range and the live preview renders the whole image white.
async function expectFullRangeBoundsPreviewAllWhite(): Promise<number> {
  await expect
    .poll(() => sourcePanelWhiteFraction())
    .toBeGreaterThan(FULL_RANGE_WHITE_FRACTION_FLOOR);
  return sourcePanelWhiteFraction();
}

async function expectWhiteFractionDroppedBelow(ceiling: number): Promise<void> {
  await expect.poll(() => sourcePanelWhiteFraction()).toBeLessThan(ceiling);
  expect(await sourcePanelWhiteFraction()).toBeGreaterThan(0.02);
}

async function expectSourceReadout(imageX: number, imageY: number, expected: number): Promise<void> {
  await expectPixelReadoutToEqual(launched.window, {
    panel: SOURCE_PANEL,
    imageX,
    imageY,
    dimensions: DIMENSIONS,
    expected,
  });
}

// With bounds [0, 114] on value(index) = 100 + 2*index: indexes 0..7 are
// in-range (white), indexes 8..15 out-of-range (black).
async function expectBinaryResultPanelReadouts(): Promise<void> {
  await expectResultReadout(0, 0, WHITE);
  await expectResultReadout(3, 0, WHITE);
  await expectResultReadout(0, 3, BLACK);
  await expectResultReadout(3, 3, BLACK);
}

async function expectResultReadout(imageX: number, imageY: number, expected: number): Promise<void> {
  await expectPixelReadoutToEqual(launched.window, {
    panel: RESULT_PANEL,
    imageX,
    imageY,
    dimensions: DIMENSIONS,
    expected,
  });
}

async function saveThenReopenProjectBundle(): Promise<void> {
  const bundlePath = join(await createTemporaryProjectBundleDirectory(), "threshold.ctbundle");
  await saveProjectBundleThroughSaveDialog({
    app: launched.app,
    page: launched.window,
    destinationPath: bundlePath,
  });
  await openProjectBundleThroughOpenDialog({
    app: launched.app,
    page: launched.window,
    bundlePath,
  });
}
