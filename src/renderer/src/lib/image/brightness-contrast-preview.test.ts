import { describe, expect, it } from "vitest";

import { applyBrightnessToRasterBands, brightnessDeltaForRangeFractionOfBand } from "./apply-brightness";
import { applyContrastToRasterBands } from "./apply-contrast";
import { buildBrightnessContrastPreviewLutOrNull } from "./brightness-contrast-preview";
import type { RasterImage } from "./raster-image";

const ENTRY_COUNT = 1024;
const LAST_ENTRY = ENTRY_COUNT - 1;
const UINT8_MAX = 255;

function makeUint8Raster(values: ReadonlyArray<number>): RasterImage {
  return {
    bandPixels: [Uint8Array.from(values)],
    width: values.length,
    height: 1,
    bandCount: 1,
    sampleFormat: "uint",
    bitsPerSample: 8,
  };
}

function clampToUnitInterval(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function sampleLutAtDisplayCoordinate(lut: ReadonlyArray<number>, coordinate: number): number {
  const position = clampToUnitInterval(coordinate) * LAST_ENTRY;
  const lower = Math.floor(position);
  const upper = Math.min(LAST_ENTRY, lower + 1);
  const fraction = position - lower;
  return (lut[lower] ?? 0) * (1 - fraction) + (lut[upper] ?? 0) * fraction;
}

function normalizedAppliedBand(
  values: ReadonlyArray<number>,
  brightnessPercent: number,
  contrastRatio: number,
): ReadonlyArray<number> {
  const raster = makeUint8Raster(values);
  const delta = brightnessDeltaForRangeFractionOfBand(raster.bandPixels[0]!, "uint", brightnessPercent / 100);
  const brightened = applyBrightnessToRasterBands(raster, [0], delta);
  const contrasted = applyContrastToRasterBands(brightened, [0], contrastRatio);
  return Array.from(contrasted.bandPixels[0]!).map((value) => value / UINT8_MAX);
}

describe("buildBrightnessContrastPreviewLutOrNull", () => {
  it("returns null for the identity adjustment (no brightness, no contrast)", () => {
    expect(buildBrightnessContrastPreviewLutOrNull(makeUint8Raster([0, 255]), 0, 0, 1)).toBeNull();
  });

  it("returns null when there is no raster to preview", () => {
    expect(buildBrightnessContrastPreviewLutOrNull(null, 0, 20, 1)).toBeNull();
  });

  it("builds a full-length display-normalized, non-decreasing lookup table", () => {
    const lut = buildBrightnessContrastPreviewLutOrNull(makeUint8Raster([0, 255]), 0, 20, 1)!;
    expect(lut).toHaveLength(ENTRY_COUNT);
    for (const entry of lut) expect(entry).toBeGreaterThanOrEqual(0);
    for (const entry of lut) expect(entry).toBeLessThanOrEqual(1);
    for (let index = 1; index < lut.length; index += 1) expect(lut[index]!).toBeGreaterThanOrEqual(lut[index - 1]!);
  });

  it("shifts every display level up by the brightness percent when contrast is 1", () => {
    const lut = buildBrightnessContrastPreviewLutOrNull(makeUint8Raster([0, 255]), 0, 20, 1)!;
    for (const index of [0, 256, 511, 800, LAST_ENTRY]) {
      expect(lut[index]!).toBeCloseTo(clampToUnitInterval(index / LAST_ENTRY + 0.2), 5);
    }
  });

  it("expands the display levels around the band mean when contrast exceeds 1", () => {
    const lut = buildBrightnessContrastPreviewLutOrNull(makeUint8Raster([0, 255]), 0, 0, 2)!;
    expect(lut[0]!).toBe(0);
    expect(lut[LAST_ENTRY]!).toBe(1);
    expect(lut[511]!).toBeCloseTo(0.5, 1);
  });

  it("matches the committed brightness-then-contrast Apply pipeline within display tolerance", () => {
    const values = [40, 120, 200];
    const lut = buildBrightnessContrastPreviewLutOrNull(makeUint8Raster(values), 0, 15, 1.3)!;
    const applied = normalizedAppliedBand(values, 15, 1.3);
    values.forEach((value, pixelIndex) => {
      const previewed = sampleLutAtDisplayCoordinate(lut, value / UINT8_MAX);
      expect(previewed).toBeCloseTo(applied[pixelIndex]!, 2);
    });
  });
});
