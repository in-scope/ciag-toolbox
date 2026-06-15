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

// LIVE vs PINNED (CT-133): the live hovered-pixel line is dashed (strokeDasharray "3 3",
// text-muted-foreground - buildLiveHoverSpectrumLineOrNull); a PINNED line is solid (no
// strokeDasharray). Both are <path fill="none"> spectrum lines, so the dash attribute is the
// only visual difference, which is exactly what AC2 ("live distinct/dashed" vs "pinned solid")
// asks the spec to prove.

export function liveHoverSpectrumLine(page: Page): Locator {
  return spectraPlot(page).locator('path[fill="none"][stroke-dasharray]');
}

export function pinnedSpectrumLines(page: Page): Locator {
  return spectraPlot(page).locator('path[fill="none"]:not([stroke-dasharray])');
}

export async function expectLiveHoverSpectrumVisible(page: Page): Promise<void> {
  await expect(liveHoverSpectrumLine(page).first()).toBeVisible();
}

export async function expectNoLiveHoverSpectrum(page: Page): Promise<void> {
  await expect.poll(() => liveHoverSpectrumLine(page).count()).toBe(0);
}

export async function expectPinnedSpectrumLineCount(page: Page, expected: number): Promise<void> {
  await expect.poll(() => pinnedSpectrumLines(page).count()).toBe(expected);
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

// REGION (ROI-mean) spectra (CT-147 / manual section 14): committing an inspection ROI on a
// multi-band raster pins that region's MEAN spectrum with a +/- 1 standard-deviation envelope.
// The envelope is a filled ribbon <path> (the only path carrying className "opacity-20"); the
// mean line is the usual solid <path fill="none"> tinted by the region's color class. The app
// keeps at most two region spectra (a third drops the oldest) and stores them separately from
// pinned PIXEL spectra, so neither mechanism evicts the other. Region colors are assigned by
// position: ROI 1 -> text-primary, ROI 2 -> text-fuchsia-400.

export function regionMeanSpectrumEnvelopes(page: Page): Locator {
  return spectraPlot(page).locator('path[class*="opacity-20"]');
}

export async function expectRegionSpectrumCount(page: Page, expected: number): Promise<void> {
  await expect.poll(() => regionMeanSpectrumEnvelopes(page).count()).toBe(expected);
}

export function regionMeanSpectrumLineWithColor(page: Page, colorClass: string): Locator {
  return spectraPlot(page).locator(`path[fill="none"][class*="${colorClass}"]`);
}

export function regionSpectrumLegendRows(page: Page): Locator {
  return page.getByText(/^ROI \d+ mean \(n=\d+px\) \+\/- 1 sigma$/);
}

export function pinnedPixelSpectrumLegendRows(page: Page): Locator {
  return page.getByText(/^Pixel \(\d+, \d+\)$/);
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

// X-POSITION ORACLE (CT-149): the plot uses a FIXED viewBox (spectrum-plot SPECTRUM_PLOT_WIDTH_PX),
// so each spectrum point's x in the `d` attribute is a deterministic projection of that band's
// ORIGINAL index/wavelength (projectXPositionToPixelX over the kept bands' min..max). Reading the
// pinned line's point x-coordinates in band order proves the kept bands stay at their original
// x-positions: removing a MIDDLE band leaves the surviving endpoints' x unchanged (the axis min/max
// are unchanged) with the middle point dropped, and no straight bridge spans the gap.

export async function readPinnedSpectrumLinePointXs(page: Page): Promise<number[]> {
  const pathData = (await pinnedSpectrumLines(page).first().getAttribute("d")) ?? "";
  return extractSpectrumPointXs(pathData);
}

function extractSpectrumPointXs(pathData: string): number[] {
  const pointMatches = pathData.matchAll(/[ML]\s*(-?[\d.]+)\s+(-?[\d.]+)/g);
  return [...pointMatches].map((match) => Number(match[1]));
}
