import { expect } from "@playwright/test";
import sharp from "sharp";
import type { Locator } from "@playwright/test";

// CT-156 / CT-100 / manual section 26.4-26.5: the histogram bar fill rounding makes
// adjacent NON-empty bars meet seamlessly (no hairline vertical stripes), while
// genuinely empty bins still render empty. The bars are painted in the chromatic
// primary color over a neutral (gray) muted background, so a column carries a bar iff
// its pixel is strongly chromatic. Reading the mid-height row across the canvas yields
// a painted/unpainted profile: a fully populated histogram is one contiguous painted
// run (the seam fix), while a bimodal distribution leaves a real unpainted gap between
// its two clusters (the empty middle bins). Equal-count fixtures make every non-empty
// bar full height, so the mid row is a clean, rounding-corner-free probe.

const CHROMATIC_BAR_CHANNEL_SPREAD_THRESHOLD = 40;

export interface HistogramRowProfile {
  readonly totalColumnCount: number;
  readonly paintedColumnCount: number;
  readonly interiorUnpaintedGapRunCount: number;
  readonly leftEdgePainted: boolean;
  readonly rightEdgePainted: boolean;
  readonly centerUnpainted: boolean;
}

export async function readHistogramMidRowProfile(canvas: Locator): Promise<HistogramRowProfile> {
  const painted = await readHistogramMidRowPaintedColumns(canvas);
  return summarizePaintedColumns(painted);
}

async function readHistogramMidRowPaintedColumns(canvas: Locator): Promise<boolean[]> {
  const screenshot = await canvas.screenshot();
  const { data, info } = await sharp(screenshot).raw().toBuffer({ resolveWithObject: true });
  return readPaintedColumnsAtRow(data, info, Math.floor(info.height / 2));
}

function readPaintedColumnsAtRow(
  data: Buffer,
  info: { width: number; height: number; channels: number },
  rowY: number,
): boolean[] {
  const columns: boolean[] = [];
  for (let x = 0; x < info.width; x += 1) {
    columns.push(isChromaticBarPixel(data, (rowY * info.width + x) * info.channels));
  }
  return columns;
}

function isChromaticBarPixel(data: Buffer, offset: number): boolean {
  const red = data[offset] ?? 0;
  const green = data[offset + 1] ?? 0;
  const blue = data[offset + 2] ?? 0;
  const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
  return spread > CHROMATIC_BAR_CHANNEL_SPREAD_THRESHOLD;
}

function summarizePaintedColumns(painted: ReadonlyArray<boolean>): HistogramRowProfile {
  return {
    totalColumnCount: painted.length,
    paintedColumnCount: painted.filter(Boolean).length,
    interiorUnpaintedGapRunCount: countInteriorUnpaintedGapRuns(painted),
    leftEdgePainted: isAnyPaintedWithinFraction(painted, 0, 0.2),
    rightEdgePainted: isAnyPaintedWithinFraction(painted, 0.8, 1),
    centerUnpainted: isNonePaintedWithinFraction(painted, 0.4, 0.6),
  };
}

function countInteriorUnpaintedGapRuns(painted: ReadonlyArray<boolean>): number {
  const first = painted.indexOf(true);
  const last = painted.lastIndexOf(true);
  if (first < 0 || last <= first) return 0;
  return countFalseRunsBetween(painted, first, last);
}

function countFalseRunsBetween(painted: ReadonlyArray<boolean>, first: number, last: number): number {
  let runs = 0;
  let insideRun = false;
  for (let index = first + 1; index < last; index += 1) {
    if (!painted[index] && !insideRun) runs += 1;
    insideRun = !painted[index];
  }
  return runs;
}

function isAnyPaintedWithinFraction(painted: ReadonlyArray<boolean>, from: number, to: number): boolean {
  return sliceByFraction(painted, from, to).some(Boolean);
}

function isNonePaintedWithinFraction(painted: ReadonlyArray<boolean>, from: number, to: number): boolean {
  return sliceByFraction(painted, from, to).every((value) => !value);
}

function sliceByFraction(painted: ReadonlyArray<boolean>, from: number, to: number): boolean[] {
  const start = Math.floor(painted.length * from);
  const end = Math.ceil(painted.length * to);
  return painted.slice(start, end);
}

export async function expectHistogramBarsMeetWithoutGaps(canvas: Locator): Promise<void> {
  await expect.poll(async () => (await readHistogramMidRowProfile(canvas)).paintedColumnCount).toBeGreaterThan(0);
  const profile = await readHistogramMidRowProfile(canvas);
  expect(profile.interiorUnpaintedGapRunCount).toBe(0);
  expect(profile.paintedColumnCount).toBeGreaterThan(profile.totalColumnCount * 0.9);
}

export async function expectHistogramShowsEmptyMiddleBins(canvas: Locator): Promise<void> {
  await expect.poll(async () => (await readHistogramMidRowProfile(canvas)).paintedColumnCount).toBeGreaterThan(0);
  const profile = await readHistogramMidRowProfile(canvas);
  expect(profile.leftEdgePainted).toBe(true);
  expect(profile.rightEdgePainted).toBe(true);
  expect(profile.centerUnpainted).toBe(true);
}
