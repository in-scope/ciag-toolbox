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
  const ticks = pickEvenlySpacedSubsequence(positions, MAX_X_AXIS_TICKS);
  return {
    label: "Wavelength (nm)",
    bandPositions: positions,
    tickPositions: ticks,
    tickLabels: ticks.map((tick) => formatWavelengthTickLabel(tick)),
  };
}

function buildBandIndexAxis(bandCount: number): SpectrumXAxisDescriptor {
  const positions = Array.from({ length: bandCount }, (_, index) => index + 1);
  const ticks = pickEvenlySpacedSubsequence(positions, MAX_X_AXIS_TICKS);
  return {
    label: "Band index",
    bandPositions: positions,
    tickPositions: ticks,
    tickLabels: ticks.map((tick) => tick.toString()),
  };
}

function pickEvenlySpacedSubsequence(
  positions: ReadonlyArray<number>,
  maxCount: number,
): ReadonlyArray<number> {
  if (positions.length === 0) return [];
  if (positions.length <= maxCount) return [...positions];
  const result: number[] = [];
  for (let i = 0; i < maxCount; i++) {
    const fraction = i / (maxCount - 1);
    const sourceIndex = Math.round(fraction * (positions.length - 1));
    result.push(positions[sourceIndex] ?? 0);
  }
  return result;
}

function formatWavelengthTickLabel(value: number): string {
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(1);
}

export function describeSpectrumYAxisLabel(sampleFormat: RasterSampleFormat): string {
  if (sampleFormat === "float") return "Reflectance / counts";
  return "Counts";
}
