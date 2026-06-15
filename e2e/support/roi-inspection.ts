import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import type { PixelDimensions } from "./image-pixel-canvas-mapping";
import { panelCell } from "./panels";
import { pagePointForImagePixelCenter, type ImagePixel } from "./viewport-navigation";

// CT-132 / manual section 22 (CT-096): the committed inspection-ROI overlay is exactly one
// dashed border rect (fill:none, stroke-dasharray) plus four solid corner-handle squares
// (fill:var(--primary)). Clearing the ROI unmounts the whole overlay (ViewportRoiOverlay
// returns null), so these readbacks count the markers and let a spec prove "exactly one box
// with one set of handles" and "no stray markers ever accumulate" directly from the DOM.

const COMMITTED_ROI_CORNER_HANDLE_COUNT = 4;

export function committedRoiBorderRects(page: Page, panelNumber: number): Locator {
  return panelCell(page, panelNumber).locator('svg[aria-hidden="true"] rect[stroke-dasharray]');
}

export function committedRoiCornerHandleRects(page: Page, panelNumber: number): Locator {
  return panelCell(page, panelNumber).locator('svg[aria-hidden="true"] rect[fill="var(--primary)"]');
}

export async function expectExactlyOneCommittedRoi(page: Page, panelNumber: number): Promise<void> {
  await expect(committedRoiBorderRects(page, panelNumber)).toHaveCount(1);
  await expect(committedRoiCornerHandleRects(page, panelNumber)).toHaveCount(
    COMMITTED_ROI_CORNER_HANDLE_COUNT,
  );
}

export async function expectNoCommittedRoiMarkers(page: Page, panelNumber: number): Promise<void> {
  await expect(committedRoiBorderRects(page, panelNumber)).toHaveCount(0);
  await expect(committedRoiCornerHandleRects(page, panelNumber)).toHaveCount(0);
}

export async function plainClickImagePixel(
  page: Page,
  panelNumber: number,
  pixel: ImagePixel,
  imageDimensions: PixelDimensions,
): Promise<void> {
  const point = await pagePointForImagePixelCenter(page, panelNumber, pixel, imageDimensions);
  await page.mouse.click(point.x, point.y);
}
