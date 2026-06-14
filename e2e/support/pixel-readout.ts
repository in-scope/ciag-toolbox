import type { Locator, Page } from "@playwright/test";

import {
  computeCanvasPointForImagePixelAtFitView,
  type PixelDimensions,
} from "./image-pixel-canvas-mapping";
import { panelCanvas } from "./panels";

// The status bar (role="status" "Pixel readout") is the PRIMARY oracle for numeric
// assertions: it reports the TRUE, unclipped band value under the cursor. Each field
// carries a data-testid so the value can be read without brittle text parsing.
//
// CONVENTION for asserting a specific image pixel's value (repeatable across runs):
//   1. Load a stack so the panel is at its default fit-to-viewport view (zoom 1, no pan).
//   2. Call readPixelValueAt(page, panelNumber, x, y, fixtureDimensions). It hovers the
//      computed canvas point at that pixel's centre, then reads the status bar back.
//   3. It throws if the readout's reported X/Y do not match the requested pixel, so a
//      mis-mapped coordinate fails loudly instead of silently asserting the wrong pixel.
// Pass the fixture's documented dimensions (from fixture-manifest.ts) as the image size.

export interface PixelReadout {
  readonly panel: number;
  readonly imageX: number;
  readonly imageY: number;
  readonly bandLabel: string | null;
  readonly value: string;
}

export function statusBar(page: Page): Locator {
  return page.getByRole("status", { name: "Pixel readout" });
}

export async function hoverImagePixel(
  page: Page,
  panelNumber: number,
  imageX: number,
  imageY: number,
  imageDimensions: PixelDimensions,
): Promise<void> {
  const box = await readPanelCanvasBoundingBox(page, panelNumber);
  const point = computeCanvasPointForImagePixelAtFitView(imageX, imageY, imageDimensions, box);
  await page.mouse.move(box.x + point.x, box.y + point.y);
}

export async function readPixelReadout(page: Page): Promise<PixelReadout> {
  const bar = statusBar(page);
  return {
    panel: await readReadoutNumberField(bar, "pixel-readout-panel"),
    imageX: await readReadoutNumberField(bar, "pixel-readout-x"),
    imageY: await readReadoutNumberField(bar, "pixel-readout-y"),
    bandLabel: await readReadoutBandLabelOrNull(bar),
    value: await readReadoutTextField(bar, "pixel-readout-value"),
  };
}

export async function readPixelValueAt(
  page: Page,
  panelNumber: number,
  imageX: number,
  imageY: number,
  imageDimensions: PixelDimensions,
): Promise<PixelReadout> {
  await hoverImagePixel(page, panelNumber, imageX, imageY, imageDimensions);
  const readout = await readPixelReadout(page);
  assertReadoutLandedOnRequestedPixel(readout, imageX, imageY);
  return readout;
}

function assertReadoutLandedOnRequestedPixel(
  readout: PixelReadout,
  imageX: number,
  imageY: number,
): void {
  if (readout.imageX === imageX && readout.imageY === imageY) return;
  throw new Error(
    `Hover landed on pixel (${readout.imageX}, ${readout.imageY}) but expected (${imageX}, ${imageY})`,
  );
}

async function readPanelCanvasBoundingBox(
  page: Page,
  panelNumber: number,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await panelCanvas(page, panelNumber).boundingBox();
  if (!box) throw new Error(`Panel ${panelNumber} canvas has no bounding box`);
  return box;
}

async function readReadoutNumberField(bar: Locator, testId: string): Promise<number> {
  return Number.parseInt(await readReadoutTextField(bar, testId), 10);
}

async function readReadoutTextField(bar: Locator, testId: string): Promise<string> {
  return (await bar.getByTestId(testId).innerText()).trim();
}

async function readReadoutBandLabelOrNull(bar: Locator): Promise<string | null> {
  const field = bar.getByTestId("pixel-readout-band");
  if ((await field.count()) === 0) return null;
  return (await field.innerText()).trim();
}
