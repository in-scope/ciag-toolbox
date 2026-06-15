import { test, expect } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  activateRegionTool,
  dragMouseFromTo,
  drawInspectionRoiBetweenPixels,
  ensureRegionToolInactive,
  loadFixtureAsStack,
  pagePointForImagePixelCenter,
  panelCanvasCenter,
  pixelsPerImagePixelVertically,
  readCommittedRoiOverlayRect,
  readPixelValueAt,
  readReadoutAtPagePoint,
  resetViewWithDoubleClick,
  selectPanel,
  wheelAtPagePoint,
} from "./support/page-objects";

// Manual test script section 6 (CT-006 / CT-120): pan and zoom.
//
// Assertions read the viewport's reported transform numerically, never by eyeballing:
//   - ZOOM is measured from the committed inspection-ROI overlay rect, whose canvas
//     width scales exactly with userZoom, so width(zoomed) / width(fit) is the zoom
//     ratio at any magnification.
//   - PAN / anchoring is measured from the status-bar pixel readout (the image pixel
//     under a fixed canvas point).

const PANEL = 1;
const IMAGE = { width: multiBandTiff.width, height: multiBandTiff.height };
const WHEEL_STEP_DELTA = 1000;
const ANCHOR_PIXEL = { x: 1, y: 1 };
const ROI_START = { x: 0, y: 0 };
const ROI_END = { x: 2, y: 2 };

// The renderer clamps zoom to [MIN_USER_ZOOM, computeMaxUserZoom] = [0.75x, 32x] of
// fit for a tiny fixture (view-transform.ts). The 0.75x floor is INTENDED, not a bug:
// view-transform.test.ts asserts it under "allows pulling 25% out beyond
// fit-to-viewport", so manual-script step 6.2 ("cannot zoom out beyond
// fit-to-viewport") is stale and this spec asserts the real 0.75x floor.
const MAX_ZOOM_RATIO = 32;
const MIN_ZOOM_RATIO = 0.75;

let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, PANEL);
});

test.afterAll(async () => {
  await closeToolboxApp(launched);
});

test.beforeEach(async () => {
  await ensureRegionToolInactive(launched.window);
  await resetViewWithDoubleClick(launched.window, await panelCanvasCenter(launched.window, PANEL));
});

test("wheel-up zooms in and stays anchored under the cursor", async () => {
  const page = launched.window;
  await activateRegionTool(page);
  await drawInspectionRoiBetweenPixels(page, PANEL, ROI_START, ROI_END, IMAGE);
  const anchor = await pagePointForImagePixelCenter(page, PANEL, ANCHOR_PIXEL, IMAGE);
  const before = await readReadoutAtPagePoint(page, anchor);
  expectReadoutReportsPixel(before, ANCHOR_PIXEL);
  const fitWidth = (await readCommittedRoiOverlayRect(page, PANEL)).width;
  await wheelAtPagePoint(page, anchor, -WHEEL_STEP_DELTA, 2);
  const zoomedWidth = (await readCommittedRoiOverlayRect(page, PANEL)).width;
  expect(zoomedWidth).toBeGreaterThan(fitWidth * 1.5);
  expectReadoutReportsPixel(await readReadoutAtPagePoint(page, anchor), ANCHOR_PIXEL);
});

test("wheel-down clamps at the intended 0.75x fit floor (no further zoom-out)", async () => {
  const page = launched.window;
  const center = await panelCanvasCenter(page, PANEL);
  await activateRegionTool(page);
  await drawInspectionRoiBetweenPixels(page, PANEL, ROI_START, ROI_END, IMAGE);
  const fitWidth = (await readCommittedRoiOverlayRect(page, PANEL)).width;
  await wheelAtPagePoint(page, center, WHEEL_STEP_DELTA, 30);
  const flooredWidth = (await readCommittedRoiOverlayRect(page, PANEL)).width;
  expectZoomRatioCloseTo(flooredWidth / fitWidth, MIN_ZOOM_RATIO);
  await wheelAtPagePoint(page, center, WHEEL_STEP_DELTA, 10);
  const stillFlooredWidth = (await readCommittedRoiOverlayRect(page, PANEL)).width;
  expect(stillFlooredWidth).toBeCloseTo(flooredWidth, 0);
});

test("wheel-up clamps at the ~32x maximum (no infinite zoom)", async () => {
  const page = launched.window;
  const center = await panelCanvasCenter(page, PANEL);
  await activateRegionTool(page);
  await drawInspectionRoiBetweenPixels(page, PANEL, ROI_START, ROI_END, IMAGE);
  const fitWidth = (await readCommittedRoiOverlayRect(page, PANEL)).width;
  await wheelAtPagePoint(page, center, -WHEEL_STEP_DELTA, 30);
  const cappedWidth = (await readCommittedRoiOverlayRect(page, PANEL)).width;
  expectZoomRatioCloseTo(cappedWidth / fitWidth, MAX_ZOOM_RATIO);
  await wheelAtPagePoint(page, center, -WHEEL_STEP_DELTA, 10);
  const stillCappedWidth = (await readCommittedRoiOverlayRect(page, PANEL)).width;
  expect(stillCappedWidth).toBeCloseTo(cappedWidth, 0);
});

test("click-drag pans the image, following the cursor", async () => {
  const page = launched.window;
  const probePixel = { x: 1, y: 2 };
  const probe = await pagePointForImagePixelCenter(page, PANEL, probePixel, IMAGE);
  const before = await readReadoutAtPagePoint(page, probe);
  expectReadoutReportsPixel(before, probePixel);
  const dragSpan = 1.3 * (await pixelsPerImagePixelVertically(page, PANEL, IMAGE));
  await dragMouseFromTo(page, probe, { x: probe.x, y: probe.y + dragSpan });
  const after = await readReadoutAtPagePoint(page, probe);
  expect(after.imageY).toBeLessThan(before.imageY);
  expect(Math.abs(after.imageX - before.imageX)).toBeLessThanOrEqual(1);
});

test("double-click resets to fit-to-viewport, centered", async () => {
  const page = launched.window;
  const center = await panelCanvasCenter(page, PANEL);
  await wheelAtPagePoint(page, center, -WHEEL_STEP_DELTA, 2);
  await dragMouseFromTo(page, center, { x: center.x + 80, y: center.y + 60 });
  await resetViewWithDoubleClick(page, center);
  const topLeft = await readPixelValueAt(page, PANEL, 0, 0, IMAGE);
  const bottomRight = await readPixelValueAt(page, PANEL, IMAGE.width - 1, IMAGE.height - 1, IMAGE);
  expectReadoutReportsPixel(topLeft, { x: 0, y: 0 });
  expectReadoutReportsPixel(bottomRight, { x: IMAGE.width - 1, y: IMAGE.height - 1 });
});

function expectReadoutReportsPixel(
  readout: { imageX: number; imageY: number },
  pixel: { x: number; y: number },
): void {
  expect(readout.imageX).toBe(pixel.x);
  expect(readout.imageY).toBe(pixel.y);
}

function expectZoomRatioCloseTo(actualRatio: number, expectedRatio: number): void {
  expect(actualRatio).toBeGreaterThan(expectedRatio * 0.95);
  expect(actualRatio).toBeLessThan(expectedRatio * 1.05);
}
