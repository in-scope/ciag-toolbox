import sharp from "sharp";
import type { Locator } from "@playwright/test";

// Samples what the viewport canvas actually paints (manual test script section 5).
// A Playwright element screenshot captures the COMPOSITED output, so it reads the
// rendered WebGL pixels reliably regardless of the context's preserveDrawingBuffer
// setting (the renderer leaves it at the default false). The renderer clears to
// opaque black (0,0,0), so "non-blank" means pixels brighter than that clear color.

const CLEAR_COLOR_LUMINANCE_SUM_THRESHOLD = 24;

// A panel canvas is replaced by a React remount (e.g. a fresh-app round-trip reopening a
// file into a panel) between Playwright resolving the locator and running the element
// screenshot, which throws "Element is not attached to the DOM". The panelCanvas locator
// re-resolves on every use, so retrying after a settle picks up the freshly mounted canvas.
const DETACHED_ELEMENT_ERROR_FRAGMENT = "not attached to the DOM";
const MAX_CANVAS_SCREENSHOT_ATTEMPTS = 5;
const CANVAS_SCREENSHOT_RETRY_DELAY_MS = 100;

async function captureCanvasScreenshotRetryingWhenDetached(canvas: Locator): Promise<Buffer> {
  for (let attempt = 1; attempt < MAX_CANVAS_SCREENSHOT_ATTEMPTS; attempt += 1) {
    const screenshot = await screenshotCanvasOrNullWhenDetached(canvas);
    if (screenshot) return screenshot;
    await canvas.page().waitForTimeout(CANVAS_SCREENSHOT_RETRY_DELAY_MS);
  }
  return canvas.screenshot();
}

async function screenshotCanvasOrNullWhenDetached(canvas: Locator): Promise<Buffer | null> {
  try {
    return await canvas.screenshot();
  } catch (error) {
    if (errorReportsDetachedElement(error)) return null;
    throw error;
  }
}

function errorReportsDetachedElement(error: unknown): boolean {
  return error instanceof Error && error.message.includes(DETACHED_ELEMENT_ERROR_FRAGMENT);
}

export interface CanvasPixelSummary {
  readonly sampledPixelCount: number;
  readonly nonClearPixelCount: number;
  readonly distinctColorCount: number;
}

export async function summarizeCanvasPixels(canvas: Locator): Promise<CanvasPixelSummary> {
  const screenshot = await captureCanvasScreenshotRetryingWhenDetached(canvas);
  const { data, info } = await sharp(screenshot)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return summarizeRgbaBuffer(data, info.channels);
}

export function nonClearPixelFraction(summary: CanvasPixelSummary): number {
  if (summary.sampledPixelCount === 0) return 0;
  return summary.nonClearPixelCount / summary.sampledPixelCount;
}

function summarizeRgbaBuffer(data: Buffer, channels: number): CanvasPixelSummary {
  const distinctColors = new Set<number>();
  let nonClearPixelCount = 0;
  const pixelCount = Math.floor(data.length / channels);
  for (let index = 0; index < pixelCount; index += 1) {
    const color = readPackedRgbAtPixel(data, index * channels);
    if (isBrighterThanClearColor(color)) nonClearPixelCount += 1;
    distinctColors.add(color);
  }
  return { sampledPixelCount: pixelCount, nonClearPixelCount, distinctColorCount: distinctColors.size };
}

export interface CanvasAverageColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly sampledPixelCount: number;
}

// Averages the R/G/B channels over the pixels brighter than the clear color, so the
// letterbox black around a fit-to-viewport image does not dilute the result. Order
// sensitivity (CT-145): routing a band to the red vs blue channel flips which channel
// dominates the composite, so swapping two assignments measurably swaps these averages.
export async function averageNonClearCanvasColor(canvas: Locator): Promise<CanvasAverageColor> {
  const screenshot = await captureCanvasScreenshotRetryingWhenDetached(canvas);
  const { data, info } = await sharp(screenshot).raw().toBuffer({ resolveWithObject: true });
  return averageNonClearRgbaBuffer(data, info.channels);
}

function averageNonClearRgbaBuffer(data: Buffer, channels: number): CanvasAverageColor {
  const totals = { red: 0, green: 0, blue: 0, count: 0 };
  const pixelCount = Math.floor(data.length / channels);
  for (let index = 0; index < pixelCount; index += 1) {
    accumulateNonClearPixel(totals, data, index * channels);
  }
  return buildAverageColorFromTotals(totals);
}

function accumulateNonClearPixel(
  totals: { red: number; green: number; blue: number; count: number },
  data: Buffer,
  offset: number,
): void {
  const color = readPackedRgbAtPixel(data, offset);
  if (!isBrighterThanClearColor(color)) return;
  totals.red += (color >> 16) & 0xff;
  totals.green += (color >> 8) & 0xff;
  totals.blue += color & 0xff;
  totals.count += 1;
}

function buildAverageColorFromTotals(totals: {
  red: number;
  green: number;
  blue: number;
  count: number;
}): CanvasAverageColor {
  if (totals.count === 0) return { red: 0, green: 0, blue: 0, sampledPixelCount: 0 };
  return {
    red: totals.red / totals.count,
    green: totals.green / totals.count,
    blue: totals.blue / totals.count,
    sampledPixelCount: totals.count,
  };
}

// CT-159: a grayscale render emits R==G==B per pixel (the shader replicates one
// band), so a colour image that lost its colour reads as ~0 here. A true-colour
// composite keeps channels apart, so a healthy fraction of pixels clear this bar.
const GRAYSCALE_CHANNEL_SPREAD_THRESHOLD = 24;

export async function colorfulNonClearPixelFraction(canvas: Locator): Promise<number> {
  const screenshot = await captureCanvasScreenshotRetryingWhenDetached(canvas);
  const { data, info } = await sharp(screenshot).raw().toBuffer({ resolveWithObject: true });
  return computeColorfulNonClearPixelFraction(data, info.channels);
}

function computeColorfulNonClearPixelFraction(data: Buffer, channels: number): number {
  let nonClearPixelCount = 0;
  let colorfulPixelCount = 0;
  const pixelCount = Math.floor(data.length / channels);
  for (let index = 0; index < pixelCount; index += 1) {
    const color = readPackedRgbAtPixel(data, index * channels);
    if (!isBrighterThanClearColor(color)) continue;
    nonClearPixelCount += 1;
    if (channelSpreadExceedsGrayscaleThreshold(color)) colorfulPixelCount += 1;
  }
  return nonClearPixelCount === 0 ? 0 : colorfulPixelCount / nonClearPixelCount;
}

function channelSpreadExceedsGrayscaleThreshold(packedRgb: number): boolean {
  const red = (packedRgb >> 16) & 0xff;
  const green = (packedRgb >> 8) & 0xff;
  const blue = packedRgb & 0xff;
  return Math.max(red, green, blue) - Math.min(red, green, blue) > GRAYSCALE_CHANNEL_SPREAD_THRESHOLD;
}

function readPackedRgbAtPixel(data: Buffer, offset: number): number {
  const red = data[offset] ?? 0;
  const green = data[offset + 1] ?? 0;
  const blue = data[offset + 2] ?? 0;
  return (red << 16) | (green << 8) | blue;
}

function isBrighterThanClearColor(packedRgb: number): boolean {
  const red = (packedRgb >> 16) & 0xff;
  const green = (packedRgb >> 8) & 0xff;
  const blue = packedRgb & 0xff;
  return red + green + blue > CLEAR_COLOR_LUMINANCE_SUM_THRESHOLD;
}
