import { test, expect } from "@playwright/test";

import { multiBandTiff, noisyGrayPng } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  activateRegionTool,
  clickPanelToSelect,
  dragMouseFromTo,
  drawInspectionRoiBetweenPixels,
  differentSizeLinkErrorToast,
  duplicatePanelViaContextMenu,
  ensureRegionToolInactive,
  expectPanelIsLinked,
  expectPanelIsNotLinked,
  linkPanZoomFromPanelContextMenu,
  loadFixtureAsStack,
  pagePointForImagePixelCenter,
  panelCanvasCenter,
  pixelsPerImagePixelVertically,
  readCommittedRoiOverlayRect,
  readReadoutAtPagePoint,
  resetViewWithDoubleClick,
  wheelAtPagePoint,
} from "./support/page-objects";

// CT-207: linked pan & zoom across panel groups. Two same-size panels (a duplicate
// of multiband-12bit.tif, both 4x4) are linked; a third panel (noisy-gray.png, 8x8)
// is a different size and must be rejected from the link. Zoom sync is asserted via
// the committed inspection-ROI overlay rect (its canvas width scales with userZoom,
// the pan-zoom.spec oracle); pan sync via the status-bar pixel readout.

const SAME_SIZE_PANEL_A = 1;
const SAME_SIZE_PANEL_B = 2;
const DIFFERENT_SIZE_PANEL = 3;
const IMAGE_4X4 = { width: multiBandTiff.width, height: multiBandTiff.height };
const IMAGE_8X8 = { width: noisyGrayPng.width, height: noisyGrayPng.height };
const ROI_START = { x: 0, y: 0 };
const ROI_END = { x: 2, y: 2 };
const PAN_PROBE_PIXEL = { x: 2, y: 2 };
const WHEEL_STEP_DELTA = 1000;

let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchToolboxApp();
  const page = launched.window;
  await loadFixtureAsStack(page, multiBandTiff.fileName);
  await duplicatePanelViaContextMenu(page, SAME_SIZE_PANEL_A);
  await loadFixtureAsStack(page, noisyGrayPng.fileName);
  await linkSameSizePanels(page);
});

test.afterAll(async () => {
  await closeToolboxApp(launched);
});

async function linkSameSizePanels(page: LaunchedApp["window"]): Promise<void> {
  await clickPanelToSelect(page, SAME_SIZE_PANEL_A);
  await clickPanelToSelect(page, SAME_SIZE_PANEL_B, { ctrlOrMeta: true });
  await linkPanZoomFromPanelContextMenu(page, SAME_SIZE_PANEL_B);
  await expectPanelIsLinked(page, SAME_SIZE_PANEL_A);
  await expectPanelIsLinked(page, SAME_SIZE_PANEL_B);
}

test("zooming one linked panel zooms its linked peer to the same level", async () => {
  const page = launched.window;
  await ensureRegionToolInactive(page);
  await resetViewWithDoubleClick(page, await panelCanvasCenter(page, SAME_SIZE_PANEL_A));
  await activateRegionTool(page);
  await drawInspectionRoiBetweenPixels(page, SAME_SIZE_PANEL_A, ROI_START, ROI_END, IMAGE_4X4);
  await drawInspectionRoiBetweenPixels(page, SAME_SIZE_PANEL_B, ROI_START, ROI_END, IMAGE_4X4);
  const fitWidthA = (await readCommittedRoiOverlayRect(page, SAME_SIZE_PANEL_A)).width;
  const fitWidthB = (await readCommittedRoiOverlayRect(page, SAME_SIZE_PANEL_B)).width;
  await wheelAtCenter(page, SAME_SIZE_PANEL_A);
  const zoomedWidthA = (await readCommittedRoiOverlayRect(page, SAME_SIZE_PANEL_A)).width;
  const zoomedWidthB = (await readCommittedRoiOverlayRect(page, SAME_SIZE_PANEL_B)).width;
  expect(zoomedWidthA).toBeGreaterThan(fitWidthA * 1.5);
  expect(zoomedWidthB / fitWidthB).toBeCloseTo(zoomedWidthA / fitWidthA, 1);
});

test("panning one linked panel pans its linked peer in sync", async () => {
  const page = launched.window;
  await ensureRegionToolInactive(page);
  await resetViewWithDoubleClick(page, await panelCanvasCenter(page, SAME_SIZE_PANEL_A));
  const probeB = await pagePointForImagePixelCenter(page, SAME_SIZE_PANEL_B, PAN_PROBE_PIXEL, IMAGE_4X4);
  const probeA = await pagePointForImagePixelCenter(page, SAME_SIZE_PANEL_A, PAN_PROBE_PIXEL, IMAGE_4X4);
  const beforePeerReadout = await readReadoutAtPagePoint(page, probeB);
  const dragSpan = await pixelsPerImagePixelVertically(page, SAME_SIZE_PANEL_A, IMAGE_4X4);
  await dragMouseFromTo(page, probeA, { x: probeA.x, y: probeA.y + dragSpan });
  const afterPeerReadout = await readReadoutAtPagePoint(page, probeB);
  const afterSourceReadout = await readReadoutAtPagePoint(page, probeA);
  expectReadoutsReportTheSamePixel(afterPeerReadout, afterSourceReadout);
  expectReadoutsReportDifferentPixels(afterPeerReadout, beforePeerReadout);
});

test("a different-size panel cannot be linked", async () => {
  const page = launched.window;
  await ensureRegionToolInactive(page);
  await resetViewWithDoubleClick(page, await panelCanvasCenter(page, DIFFERENT_SIZE_PANEL));
  await clickPanelToSelect(page, SAME_SIZE_PANEL_A);
  await clickPanelToSelect(page, DIFFERENT_SIZE_PANEL, { ctrlOrMeta: true });
  await linkPanZoomFromPanelContextMenu(page, DIFFERENT_SIZE_PANEL);
  await expect(differentSizeLinkErrorToast(page)).toBeVisible();
  await expectPanelIsNotLinked(page, DIFFERENT_SIZE_PANEL);
  await expectDifferentSizePanelIgnoresLinkedZoom(page);
});

async function expectDifferentSizePanelIgnoresLinkedZoom(
  page: LaunchedApp["window"],
): Promise<void> {
  await activateRegionTool(page);
  await drawInspectionRoiBetweenPixels(page, DIFFERENT_SIZE_PANEL, ROI_START, ROI_END, IMAGE_8X8);
  const fitWidth = (await readCommittedRoiOverlayRect(page, DIFFERENT_SIZE_PANEL)).width;
  await wheelAtCenter(page, SAME_SIZE_PANEL_A);
  const afterWidth = (await readCommittedRoiOverlayRect(page, DIFFERENT_SIZE_PANEL)).width;
  expect(afterWidth).toBeCloseTo(fitWidth, 0);
}

async function wheelAtCenter(page: LaunchedApp["window"], panelNumber: number): Promise<void> {
  await wheelAtPagePoint(page, await panelCanvasCenter(page, panelNumber), -WHEEL_STEP_DELTA, 2);
}

function expectReadoutsReportTheSamePixel(
  left: { imageX: number; imageY: number },
  right: { imageX: number; imageY: number },
): void {
  expect(left.imageX).toBe(right.imageX);
  expect(left.imageY).toBe(right.imageY);
}

function expectReadoutsReportDifferentPixels(
  left: { imageX: number; imageY: number },
  right: { imageX: number; imageY: number },
): void {
  expect(left.imageX !== right.imageX || left.imageY !== right.imageY).toBe(true);
}
