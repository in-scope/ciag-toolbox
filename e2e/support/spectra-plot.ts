import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import {
  computeCanvasPointForImagePixelAtFitView,
  type PixelDimensions,
} from "./image-pixel-canvas-mapping";
import { applicationToolbar } from "./operations";
import { panelCanvas } from "./panels";

// The Spectra section's plot is an <svg aria-label="Spectra plot">; each spectrum line is a
// <path fill="none"> whose `d` is built per CONTIGUOUS band run, starting a new "M" subpath
// per run (spectrum-plot-geometry.buildSpectrumLinePathFromValues). So the count of "M"
// commands equals the number of runs: a contiguous stack draws one subpath, and removing a
// middle band splits the line into two, leaving the visible gap at the removed position.
//
// PINNING: on a multi-band raster a plain left-click on the canvas pins that pixel's
// spectrum (viewport pixel-click-input), which is what renders the plot (the section shows
// an empty state until a spectrum is pinned or hovered).

export function spectraPlot(page: Page): Locator {
  return page.getByRole("img", { name: "Spectra plot" });
}

export function spectrumLinePaths(page: Page): Locator {
  return spectraPlot(page).locator('path[fill="none"]');
}

export async function pinPixelSpectrum(
  page: Page,
  panelNumber: number,
  imageX: number,
  imageY: number,
  imageDimensions: PixelDimensions,
): Promise<void> {
  const point = await canvasPagePointForImagePixel(page, panelNumber, imageX, imageY, imageDimensions);
  await page.mouse.click(point.x, point.y);
  await applicationToolbar(page).hover();
  await expect(spectraPlot(page)).toBeVisible();
}

async function canvasPagePointForImagePixel(
  page: Page,
  panelNumber: number,
  imageX: number,
  imageY: number,
  imageDimensions: PixelDimensions,
): Promise<{ x: number; y: number }> {
  const box = await panelCanvas(page, panelNumber).boundingBox();
  if (!box) throw new Error(`Panel ${panelNumber} canvas has no bounding box`);
  const point = computeCanvasPointForImagePixelAtFitView(imageX, imageY, imageDimensions, box);
  return { x: box.x + point.x, y: box.y + point.y };
}

export async function expectSpectrumLineSubpathCount(page: Page, expected: number): Promise<void> {
  await expect.poll(() => readFirstSpectrumLineSubpathCount(page)).toBe(expected);
}

async function readFirstSpectrumLineSubpathCount(page: Page): Promise<number> {
  const path = spectrumLinePaths(page).first();
  if ((await path.count()) === 0) return 0;
  return countMoveCommands((await path.getAttribute("d")) ?? "");
}

function countMoveCommands(pathData: string): number {
  return (pathData.match(/M/g) ?? []).length;
}
