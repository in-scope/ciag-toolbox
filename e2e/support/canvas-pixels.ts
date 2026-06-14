import sharp from "sharp";
import type { Locator } from "@playwright/test";

// Samples what the viewport canvas actually paints (manual test script section 5).
// A Playwright element screenshot captures the COMPOSITED output, so it reads the
// rendered WebGL pixels reliably regardless of the context's preserveDrawingBuffer
// setting (the renderer leaves it at the default false). The renderer clears to
// opaque black (0,0,0), so "non-blank" means pixels brighter than that clear color.

const CLEAR_COLOR_LUMINANCE_SUM_THRESHOLD = 24;

export interface CanvasPixelSummary {
  readonly sampledPixelCount: number;
  readonly nonClearPixelCount: number;
  readonly distinctColorCount: number;
}

export async function summarizeCanvasPixels(canvas: Locator): Promise<CanvasPixelSummary> {
  const screenshot = await canvas.screenshot();
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
