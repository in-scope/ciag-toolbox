import sharp from "sharp";
import type { Locator } from "@playwright/test";

// Samples what the viewport canvas actually paints (manual test script section 5).
// A Playwright element screenshot captures the COMPOSITED output, so it reads the
// rendered WebGL pixels reliably regardless of the context's preserveDrawingBuffer
// setting (the renderer leaves it at the default false). The renderer clears to
// opaque black (0,0,0), so "non-blank" means pixels brighter than that clear color.
//
// The band navigator (CT-083) is a floating panel-chrome overlay that sits ON TOP of
// the bottom of the canvas, so a Playwright element screenshot of the canvas composites
// its grey card chrome into the result. That chrome is NOT rendered image content, so it
// is masked out before measuring brightness - otherwise a near-black image reads as ~6%
// non-clear (the navigator alone) and a "brightened" assertion passes vacuously.

const CLEAR_COLOR_LUMINANCE_SUM_THRESHOLD = 24;
const BAND_NAVIGATOR_TEST_ID = "viewport-band-navigator";
const BAND_NAVIGATOR_SHADOW_PADDING_DEVICE_PX = 8;

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

interface CanvasRegionMask {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

interface DecodedCanvasPixels {
  readonly data: Buffer;
  readonly width: number;
  readonly channels: number;
  readonly bandNavigatorMask: CanvasRegionMask | null;
}

async function decodeCanvasPixelsExcludingBandNavigator(canvas: Locator): Promise<DecodedCanvasPixels> {
  const screenshot = await captureCanvasScreenshotRetryingWhenDetached(canvas);
  const { data, info } = await sharp(screenshot).raw().toBuffer({ resolveWithObject: true });
  const bandNavigatorMask = await computeBandNavigatorMaskOrNull(canvas, info.width, info.height);
  return { data, width: info.width, channels: info.channels, bandNavigatorMask };
}

async function computeBandNavigatorMaskOrNull(
  canvas: Locator,
  screenshotWidth: number,
  screenshotHeight: number,
): Promise<CanvasRegionMask | null> {
  const navigator = canvas.locator("xpath=..").getByTestId(BAND_NAVIGATOR_TEST_ID);
  if ((await navigator.count()) === 0) return null;
  const navigatorBox = await navigator.boundingBox();
  const canvasBox = await canvas.boundingBox();
  if (!navigatorBox || !canvasBox || canvasBox.width === 0 || canvasBox.height === 0) return null;
  return scaleNavigatorBoxToScreenshotMask(navigatorBox, canvasBox, screenshotWidth, screenshotHeight);
}

interface BoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function scaleNavigatorBoxToScreenshotMask(
  navigatorBox: BoundingBox,
  canvasBox: BoundingBox,
  screenshotWidth: number,
  screenshotHeight: number,
): CanvasRegionMask {
  const scaleX = screenshotWidth / canvasBox.width;
  const scaleY = screenshotHeight / canvasBox.height;
  const pad = BAND_NAVIGATOR_SHADOW_PADDING_DEVICE_PX;
  return {
    minX: Math.floor((navigatorBox.x - canvasBox.x) * scaleX) - pad,
    minY: Math.floor((navigatorBox.y - canvasBox.y) * scaleY) - pad,
    maxX: Math.ceil((navigatorBox.x - canvasBox.x + navigatorBox.width) * scaleX) + pad,
    maxY: Math.ceil((navigatorBox.y - canvasBox.y + navigatorBox.height) * scaleY) + pad,
  };
}

function isPixelInsideMask(pixelIndex: number, width: number, mask: CanvasRegionMask | null): boolean {
  if (!mask) return false;
  const x = pixelIndex % width;
  const y = Math.floor(pixelIndex / width);
  return x >= mask.minX && x < mask.maxX && y >= mask.minY && y < mask.maxY;
}

export interface CanvasPixelSummary {
  readonly sampledPixelCount: number;
  readonly nonClearPixelCount: number;
  readonly distinctColorCount: number;
}

export async function summarizeCanvasPixels(canvas: Locator): Promise<CanvasPixelSummary> {
  return summarizeDecodedCanvasPixels(await decodeCanvasPixelsExcludingBandNavigator(canvas));
}

export function nonClearPixelFraction(summary: CanvasPixelSummary): number {
  if (summary.sampledPixelCount === 0) return 0;
  return summary.nonClearPixelCount / summary.sampledPixelCount;
}

function summarizeDecodedCanvasPixels(decoded: DecodedCanvasPixels): CanvasPixelSummary {
  const distinctColors = new Set<number>();
  let nonClearPixelCount = 0;
  let sampledPixelCount = 0;
  const pixelCount = Math.floor(decoded.data.length / decoded.channels);
  for (let index = 0; index < pixelCount; index += 1) {
    if (isPixelInsideMask(index, decoded.width, decoded.bandNavigatorMask)) continue;
    sampledPixelCount += 1;
    const color = readPackedRgbAtPixel(decoded.data, index * decoded.channels);
    if (isBrighterThanClearColor(color)) nonClearPixelCount += 1;
    distinctColors.add(color);
  }
  return { sampledPixelCount, nonClearPixelCount, distinctColorCount: distinctColors.size };
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
  return averageDecodedNonClearPixels(await decodeCanvasPixelsExcludingBandNavigator(canvas));
}

function averageDecodedNonClearPixels(decoded: DecodedCanvasPixels): CanvasAverageColor {
  const totals = { red: 0, green: 0, blue: 0, count: 0 };
  const pixelCount = Math.floor(decoded.data.length / decoded.channels);
  for (let index = 0; index < pixelCount; index += 1) {
    if (isPixelInsideMask(index, decoded.width, decoded.bandNavigatorMask)) continue;
    accumulateNonClearPixel(totals, decoded.data, index * decoded.channels);
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
  return computeColorfulNonClearPixelFraction(await decodeCanvasPixelsExcludingBandNavigator(canvas));
}

function computeColorfulNonClearPixelFraction(decoded: DecodedCanvasPixels): number {
  let nonClearPixelCount = 0;
  let colorfulPixelCount = 0;
  const pixelCount = Math.floor(decoded.data.length / decoded.channels);
  for (let index = 0; index < pixelCount; index += 1) {
    if (isPixelInsideMask(index, decoded.width, decoded.bandNavigatorMask)) continue;
    const color = readPackedRgbAtPixel(decoded.data, index * decoded.channels);
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

// CT-195: an MNF component that overflowed the half-float display texture renders
// as a uniformly white panel - every sampled pixel is saturated white. A healthy
// component renders as a stretched gradient with plenty of mid-tones, so only a
// small slice of pixels is fully white. This reports the fraction of ALL sampled
// pixels (band navigator masked out) that are near-pure-white, so a "not white
// screen" assertion can require it to stay well below 1.
const SATURATED_WHITE_CHANNEL_FLOOR = 250;

export async function saturatedWhitePixelFraction(canvas: Locator): Promise<number> {
  return computeSaturatedWhitePixelFraction(await decodeCanvasPixelsExcludingBandNavigator(canvas));
}

function computeSaturatedWhitePixelFraction(decoded: DecodedCanvasPixels): number {
  let saturatedWhiteCount = 0;
  let sampledPixelCount = 0;
  const pixelCount = Math.floor(decoded.data.length / decoded.channels);
  for (let index = 0; index < pixelCount; index += 1) {
    if (isPixelInsideMask(index, decoded.width, decoded.bandNavigatorMask)) continue;
    sampledPixelCount += 1;
    if (isSaturatedWhite(readPackedRgbAtPixel(decoded.data, index * decoded.channels))) saturatedWhiteCount += 1;
  }
  return sampledPixelCount === 0 ? 0 : saturatedWhiteCount / sampledPixelCount;
}

function isSaturatedWhite(packedRgb: number): boolean {
  const red = (packedRgb >> 16) & 0xff;
  const green = (packedRgb >> 8) & 0xff;
  const blue = packedRgb & 0xff;
  return red >= SATURATED_WHITE_CHANNEL_FLOOR && green >= SATURATED_WHITE_CHANNEL_FLOOR && blue >= SATURATED_WHITE_CHANNEL_FLOOR;
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
