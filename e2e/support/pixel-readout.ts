import type { Locator, Page } from "@playwright/test";

import {
  computeCanvasPointForImagePixelAtFitView,
  type CanvasPoint,
  type PixelDimensions,
} from "./image-pixel-canvas-mapping";
import { panelCanvas } from "./panels";

// The renderer throttles pointer readout updates to ~30fps on the LEADING edge with no
// trailing emit (pointer-readout-input.ts), so a single fast hover can be dropped when it
// arrives within the throttle window of a previous move, leaving the readout stale. Each
// hover therefore re-moves the cursor (nudged within the same pixel cell so a fresh
// pointermove fires) and waits past the throttle window until the readout reports the
// requested pixel, keeping numeric assertions repeatable instead of flaky.
const POINTER_READOUT_THROTTLE_MS = 1000 / 30;
const READOUT_SETTLE_DELAY_MS = Math.ceil(POINTER_READOUT_THROTTLE_MS) + 20;
// A transient overlay (a success toast portals to the bottom-left over the lowest
// panels) can sit on top of the hovered pixel for its lifetime, so a single move
// then a long innerText wait hangs the whole 30s. Instead keep re-hovering on a time
// budget that outlasts the toast, reading the readout WITHOUT blocking so each
// attempt re-moves until the overlay clears and the canvas reports the pixel.
const HOVER_READOUT_DEADLINE_MS = 8000;
const SUB_CELL_NUDGE_CYCLE_PX = 5;

interface CanvasBoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

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
  await readPixelValueAt(page, panelNumber, imageX, imageY, imageDimensions);
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
  const box = await readPanelCanvasBoundingBox(page, panelNumber);
  const point = computeCanvasPointForImagePixelAtFitView(imageX, imageY, imageDimensions, box);
  return hoverUntilReadoutReportsRequestedPixel(page, box, point, imageX, imageY);
}

async function hoverUntilReadoutReportsRequestedPixel(
  page: Page,
  box: CanvasBoundingBox,
  point: CanvasPoint,
  imageX: number,
  imageY: number,
): Promise<PixelReadout> {
  const deadline = Date.now() + HOVER_READOUT_DEADLINE_MS;
  for (let attempt = 0; Date.now() < deadline; attempt += 1) {
    await moveCursorWithinPixelCellThenSettle(page, box, point, attempt);
    const readout = await readPixelReadoutWhenPopulatedOrNull(page);
    if (readout && readout.imageX === imageX && readout.imageY === imageY) return readout;
  }
  throw new Error(
    `Readout never reported pixel (${imageX}, ${imageY}) within ${HOVER_READOUT_DEADLINE_MS}ms`,
  );
}

async function readPixelReadoutWhenPopulatedOrNull(page: Page): Promise<PixelReadout | null> {
  const bar = statusBar(page);
  if ((await bar.getByTestId("pixel-readout-panel").count()) === 0) return null;
  return readPixelReadout(page);
}

async function moveCursorWithinPixelCellThenSettle(
  page: Page,
  box: CanvasBoundingBox,
  point: CanvasPoint,
  attempt: number,
): Promise<void> {
  const horizontalNudgePx = attempt % SUB_CELL_NUDGE_CYCLE_PX;
  await page.mouse.move(box.x + point.x + horizontalNudgePx, box.y + point.y);
  await page.waitForTimeout(READOUT_SETTLE_DELAY_MS);
}

async function readPanelCanvasBoundingBox(
  page: Page,
  panelNumber: number,
): Promise<CanvasBoundingBox> {
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
