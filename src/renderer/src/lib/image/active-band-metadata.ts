import {
  getRasterBandOriginalNumber,
  type RasterImage,
} from "@/lib/image/raster-image";

export interface ActiveBandMetadataRow {
  readonly label: string;
  readonly value: string;
}

export function buildActiveBandMetadataRows(
  raster: RasterImage,
  bandIndex: number,
): ReadonlyArray<ActiveBandMetadataRow> {
  const rows: ActiveBandMetadataRow[] = [
    { label: "Original band", value: formatOriginalBandNumber(raster, bandIndex) },
  ];
  const wavelength = formatActiveBandWavelengthOrNull(raster, bandIndex);
  if (wavelength !== null) rows.push({ label: "Wavelength", value: wavelength });
  return rows;
}

function formatOriginalBandNumber(raster: RasterImage, bandIndex: number): string {
  return String(getRasterBandOriginalNumber(raster, bandIndex));
}

function formatActiveBandWavelengthOrNull(
  raster: RasterImage,
  bandIndex: number,
): string | null {
  const wavelength = readActiveBandWavelengthOrNull(raster, bandIndex);
  if (wavelength === null) return null;
  return `${formatWavelengthNumberForDisplay(wavelength)} nm`;
}

function readActiveBandWavelengthOrNull(
  raster: RasterImage,
  bandIndex: number,
): number | null {
  const wavelengths = raster.bandWavelengths;
  if (!wavelengths || wavelengths.length !== raster.bandCount) return null;
  const value = wavelengths[bandIndex];
  if (value === undefined || !Number.isFinite(value)) return null;
  return value;
}

function formatWavelengthNumberForDisplay(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}
