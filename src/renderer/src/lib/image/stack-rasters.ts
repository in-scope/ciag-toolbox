import type { RasterImage } from "@/lib/image/raster-image";

export interface StackableRasterEntry {
  readonly raster: RasterImage;
  readonly bandLabel: string;
  readonly wavelength: number | null;
}

export interface StackedRasterPropertyMismatch {
  readonly propertyName: "width" | "height" | "bitsPerSample" | "sampleFormat";
  readonly baselineValue: number | string;
  readonly observedValue: number | string;
}

export function findStackedRasterMismatchOrNull(
  baseline: RasterImage,
  candidate: RasterImage,
): StackedRasterPropertyMismatch | null {
  return (
    findScalarMismatchOrNull("width", baseline.width, candidate.width)
    ?? findScalarMismatchOrNull("height", baseline.height, candidate.height)
    ?? findScalarMismatchOrNull("bitsPerSample", baseline.bitsPerSample, candidate.bitsPerSample)
    ?? findScalarMismatchOrNull("sampleFormat", baseline.sampleFormat, candidate.sampleFormat)
  );
}

function findScalarMismatchOrNull(
  propertyName: StackedRasterPropertyMismatch["propertyName"],
  baseline: number | string,
  candidate: number | string,
): StackedRasterPropertyMismatch | null {
  if (baseline === candidate) return null;
  return { propertyName, baselineValue: baseline, observedValue: candidate };
}

export function stackSingleBandRastersIntoMultiBandRaster(
  entries: ReadonlyArray<StackableRasterEntry>,
): RasterImage {
  requireAtLeastTwoEntries(entries);
  const [first, ...rest] = entries;
  if (!first) throw new Error("Stack requires at least one band");
  validateAllEntriesAgainstBaselineOrThrow(first.raster, rest);
  return buildStackedRasterFromValidatedEntries(first.raster, entries);
}

function requireAtLeastTwoEntries(entries: ReadonlyArray<StackableRasterEntry>): void {
  if (entries.length < 2) {
    throw new Error("Stacking requires two or more bands");
  }
}

function validateAllEntriesAgainstBaselineOrThrow(
  baseline: RasterImage,
  rest: ReadonlyArray<StackableRasterEntry>,
): void {
  for (const entry of rest) {
    const mismatch = findStackedRasterMismatchOrNull(baseline, entry.raster);
    if (mismatch) throw buildPropertyMismatchError(mismatch);
  }
}

function buildPropertyMismatchError(
  mismatch: StackedRasterPropertyMismatch,
): Error {
  return new Error(
    `Cannot stack rasters: ${mismatch.propertyName} ${String(mismatch.observedValue)} differs from baseline ${String(mismatch.baselineValue)}`,
  );
}

function buildStackedRasterFromValidatedEntries(
  baseline: RasterImage,
  entries: ReadonlyArray<StackableRasterEntry>,
): RasterImage {
  return {
    bandPixels: entries.map(pickFirstBandPixelsFromEntry),
    width: baseline.width,
    height: baseline.height,
    bitsPerSample: baseline.bitsPerSample,
    sampleFormat: baseline.sampleFormat,
    bandCount: entries.length,
    bandLabels: entries.map((entry) => entry.bandLabel),
    bandWavelengths: pickBandWavelengthsWhenAllPresent(entries),
  };
}

function pickFirstBandPixelsFromEntry(entry: StackableRasterEntry): RasterImage["bandPixels"][number] {
  const pixels = entry.raster.bandPixels[0];
  if (!pixels) {
    throw new Error(`Raster band "${entry.bandLabel}" had no pixel data`);
  }
  return pixels;
}

function pickBandWavelengthsWhenAllPresent(
  entries: ReadonlyArray<StackableRasterEntry>,
): ReadonlyArray<number> | undefined {
  const wavelengths: number[] = [];
  for (const entry of entries) {
    if (entry.wavelength === null) return undefined;
    wavelengths.push(entry.wavelength);
  }
  return wavelengths;
}
