import { formatSinglePixelReadoutValue } from "@/lib/image/compute-pixel-readout";
import {
  listRasterBandOriginalNumbers,
  type RasterImage,
  type RasterSampleFormat,
} from "@/lib/image/raster-image";
import type { SpectrumLineValueHit } from "@/lib/image/spectrum-plot-hit-test";

export interface SpectrumBandTooltipDescriptor {
  readonly bandNumber: number;
  readonly wavelengthNm: number | null;
}

export function buildSpectrumBandTooltipDescriptors(
  raster: RasterImage,
): ReadonlyArray<SpectrumBandTooltipDescriptor> {
  const wavelengths = readBandWavelengthsOrNull(raster);
  return listRasterBandOriginalNumbers(raster).map((bandNumber, index) => ({
    bandNumber,
    wavelengthNm: wavelengths ? wavelengths[index] ?? null : null,
  }));
}

function readBandWavelengthsOrNull(raster: RasterImage): ReadonlyArray<number> | null {
  if (!raster.bandWavelengths) return null;
  if (raster.bandWavelengths.length !== raster.bandCount) return null;
  return raster.bandWavelengths;
}

export function formatSpectrumHoverBandLabel(descriptor: SpectrumBandTooltipDescriptor): string {
  if (descriptor.wavelengthNm === null) return `Band ${descriptor.bandNumber}`;
  return `Band ${descriptor.bandNumber} (${Math.round(descriptor.wavelengthNm)} nm)`;
}

export function formatSpectrumHoverValueLabel(
  hit: SpectrumLineValueHit,
  sampleFormat: RasterSampleFormat,
): string {
  const valueText = formatSinglePixelReadoutValue(hit.value, sampleFormat);
  if (hit.standardDeviation === null) return valueText;
  return `${valueText} ± ${formatSinglePixelReadoutValue(hit.standardDeviation, sampleFormat)}`;
}
