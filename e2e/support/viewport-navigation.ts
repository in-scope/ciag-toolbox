import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import {
  computeCanvasPointForImagePixelAtFitView,
  type CanvasPoint,
  type PixelDimensions,
} from "./image-pixel-canvas-mapping";
import { applicationToolbar } from "./operations";
import { panelCanvas, panelCell } from "./panels";
import { readPixelReadout, type PixelReadout } from "./pixel-readout";

// Pan/zoom navigation helpers for manual-script section 6 (CT-006 / CT-120).
//
// The renderer keeps userZoom/userPan private, so the suite reads the transform
// through DOM the renderer already drives:
//   - ZOOM magnitude: the committed inspection-ROI overlay rect (the <svg> <rect>
//     carrying stroke-dasharray) whose canvas width is userZoom times a
//     pan-independent constant, so width(zoomed) / width(fit) recovers the exact
//     zoom ratio at any magnification (no floor quantisation, unlike the readout).
//   - PAN / anchoring: the status-bar pixel readout (the image pixel under a fixed
//     canvas point), which shifts as the image pans and stays fixed at the zoom
//     anchor.
// Wheel-up is negative deltaY (zoom in); the renderer clamps zoom to [0.75x, 32x]
// of fit-to-viewport.

const READOUT_THROTTLE_SETTLE_MS = 60;

export interface ImagePixel {
  readonly x: number;
  readonly y: number;
}

export interface CanvasRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function regionToolButton(page: Page): Locator {
  return applicationToolbar(page).getByRole("button", { name: /^Select Region/ });
}

export async function activateRegionTool(page: Page): Promise<void> {
  const button = regionToolButton(page);
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

export async function ensureRegionToolInactive(page: Page): Promise<void> {
  const button = regionToolButton(page);
  if ((await button.getAttribute("aria-pressed")) !== "true") return;
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "false");
}

async function readPanelCanvasBox(page: Page, panelNumber: number): Promise<CanvasRect> {
  const box = await panelCanvas(page, panelNumber).boundingBox();
  if (!box) throw new Error(`Panel ${panelNumber} canvas has no bounding box`);
  return box;
}

export async function panelCanvasCenter(page: Page, panelNumber: number): Promise<CanvasPoint> {
  const box = await readPanelCanvasBox(page, panelNumber);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function pagePointForImagePixelCenter(
  page: Page,
  panelNumber: number,
  pixel: ImagePixel,
  imageDimensions: PixelDimensions,
): Promise<CanvasPoint> {
  const box = await readPanelCanvasBox(page, panelNumber);
  const local = computeCanvasPointForImagePixelAtFitView(pixel.x, pixel.y, imageDimensions, box);
  return { x: box.x + local.x, y: box.y + local.y };
}

export async function pixelsPerImagePixelVertically(
  page: Page,
  panelNumber: number,
  imageDimensions: PixelDimensions,
): Promise<number> {
  const top = await pagePointForImagePixelCenter(page, panelNumber, { x: 0, y: 0 }, imageDimensions);
  const below = await pagePointForImagePixelCenter(page, panelNumber, { x: 0, y: 1 }, imageDimensions);
  return below.y - top.y;
}

export async function dragMouseFromTo(page: Page, from: CanvasPoint, to: CanvasPoint): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

export async function drawInspectionRoiBetweenPixels(
  page: Page,
  panelNumber: number,
  startPixel: ImagePixel,
  endPixel: ImagePixel,
  imageDimensions: PixelDimensions,
): Promise<void> {
  const from = await pagePointForImagePixelCenter(page, panelNumber, startPixel, imageDimensions);
  const to = await pagePointForImagePixelCenter(page, panelNumber, endPixel, imageDimensions);
  await dragMouseFromTo(page, from, to);
  await committedRoiBorderRect(page, panelNumber).waitFor({ state: "attached" });
}

function committedRoiBorderRect(page: Page, panelNumber: number): Locator {
  return panelCell(page, panelNumber).locator('svg[aria-hidden="true"] rect[stroke-dasharray]');
}

export async function readCommittedRoiOverlayRect(
  page: Page,
  panelNumber: number,
): Promise<CanvasRect> {
  const rect = committedRoiBorderRect(page, panelNumber);
  await rect.waitFor({ state: "attached" });
  return {
    x: await readNumericAttribute(rect, "x"),
    y: await readNumericAttribute(rect, "y"),
    width: await readNumericAttribute(rect, "width"),
    height: await readNumericAttribute(rect, "height"),
  };
}

async function readNumericAttribute(locator: Locator, name: string): Promise<number> {
  return Number.parseFloat((await locator.getAttribute(name)) ?? "");
}

export async function wheelAtPagePoint(
  page: Page,
  point: CanvasPoint,
  deltaY: number,
  wheelEventCount: number,
): Promise<void> {
  await page.mouse.move(point.x, point.y);
  for (let event = 0; event < wheelEventCount; event += 1) {
    await page.mouse.wheel(0, deltaY);
  }
  await page.waitForTimeout(READOUT_THROTTLE_SETTLE_MS);
}

export async function readReadoutAtPagePoint(
  page: Page,
  point: CanvasPoint,
): Promise<PixelReadout> {
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(READOUT_THROTTLE_SETTLE_MS);
  await page.mouse.move(point.x + 1, point.y);
  await page.waitForTimeout(READOUT_THROTTLE_SETTLE_MS);
  return readPixelReadout(page);
}

export async function resetViewWithDoubleClick(page: Page, point: CanvasPoint): Promise<void> {
  await page.mouse.move(point.x, point.y);
  await page.mouse.dblclick(point.x, point.y);
  await page.waitForTimeout(READOUT_THROTTLE_SETTLE_MS);
}
