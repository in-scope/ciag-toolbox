import type { RasterImage, RasterSampleFormat } from "@/lib/image/raster-image";

export interface SpectrumXAxisDescriptor {
  readonly label: string;
  readonly bandPositions: ReadonlyArray<number>;
  readonly tickPositions: ReadonlyArray<number>;
  readonly tickLabels: ReadonlyArray<string>;
}

const MAX_X_AXIS_TICKS = 5;

export function buildSpectrumXAxisFromRaster(raster: RasterImage): SpectrumXAxisDescriptor {
  if (raster.bandWavelengths && raster.bandWavelengths.length === raster.bandCount) {
    return buildWavelengthAxisFromBandCenters(raster.bandWavelengths);
  }
  return buildBandIndexAxis(raster.bandCount);
}

function buildWavelengthAxisFromBandCenters(
  bandWavelengths: ReadonlyArray<number>,
): SpectrumXAxisDescriptor {
  const positions = [...bandWavelengths];
  const ticks = pickTicksEvenlySpacedAcrossValueRange(positions, MAX_X_AXIS_TICKS);
  return {
    label: "Wavelength (nm)",
    bandPositions: positions,
    tickPositions: ticks,
    tickLabels: ticks.map((tick) => formatWavelengthTickLabel(tick)),
  };
}

function buildBandIndexAxis(bandCount: number): SpectrumXAxisDescriptor {
  const positions = Array.from({ length: bandCount }, (_, index) => index + 1);
  const ticks = pickTicksEvenlySpacedAcrossValueRange(positions, MAX_X_AXIS_TICKS).map(Math.round);
  const uniqueTicks = removeAdjacentDuplicateTicks(ticks);
  return {
    label: "Band index",
    bandPositions: positions,
    tickPositions: uniqueTicks,
    tickLabels: uniqueTicks.map((tick) => tick.toString()),
  };
}

function pickTicksEvenlySpacedAcrossValueRange(
  positions: ReadonlyArray<number>,
  maxCount: number,
): number[] {
  if (positions.length === 0) return [];
  const minPosition = Math.min(...positions);
  const maxPosition = Math.max(...positions);
  const tickCount = Math.min(maxCount, positions.length);
  if (tickCount <= 1 || minPosition === maxPosition) return [minPosition];
  return buildEvenlySpacedValues(minPosition, maxPosition, tickCount);
}

function buildEvenlySpacedValues(minValue: number, maxValue: number, count: number): number[] {
  const span = maxValue - minValue;
  return Array.from({ length: count }, (_, index) => minValue + (index / (count - 1)) * span);
}

function removeAdjacentDuplicateTicks(ticks: ReadonlyArray<number>): number[] {
  return ticks.filter((tick, index) => index === 0 || tick !== ticks[index - 1]);
}

function formatWavelengthTickLabel(value: number): string {
  return Math.round(value).toString();
}

export function describeSpectrumYAxisLabel(sampleFormat: RasterSampleFormat): string {
  if (sampleFormat === "float") return "Reflectance / counts";
  return "Counts";
}
