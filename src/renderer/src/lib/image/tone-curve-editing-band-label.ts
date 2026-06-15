import { describeRasterBandDisplayIdentity, type RasterImage } from "@/lib/image/raster-image";

/**
 * CT-176: a scientific multi-band stack has no channel selector - the tone-curve
 * panel instead shows a read-only label naming the band the curve currently
 * targets, which follows the band navigator's selection. The label adds the
 * band's explicit name or wavelength when the stack carries one so the user can
 * tell hyperspectral bands apart.
 */
export function formatToneCurveEditingBandLabel(raster: RasterImage, bandIndex: number): string {
  const identity = describeRasterBandDisplayIdentity(raster, bandIndex);
  return `Editing band ${identity.originalNumber}${describeBandDistinguisherSuffix(raster, bandIndex, identity.hasExplicitLabel, identity.label)}`;
}

function describeBandDistinguisherSuffix(
  raster: RasterImage,
  bandIndex: number,
  hasExplicitLabel: boolean,
  label: string,
): string {
  if (hasExplicitLabel) return ` (${label})`;
  const wavelength = raster.bandWavelengths?.[bandIndex];
  if (wavelength !== undefined) return ` (${wavelength} nm)`;
  return "";
}
