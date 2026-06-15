export type RasterSampleFormat = "uint" | "int" | "float";

export type RasterSourceInterleave = "bsq" | "bil" | "bip";

// CT-159: a raster whose three bands are true display colour channels (a decoded
// JPG/PNG promoted to R/G/B, or a RAW camera decode) carries "rgb" so the viewport
// renders an RGB composite instead of one grayscale band. Multi-band scientific
// stacks leave this undefined and keep per-band grayscale viewing with band selection.
export type RasterColorInterpretation = "rgb";

export type RasterTypedArray =
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | Int8Array
  | Int16Array
  | Int32Array
  | Float32Array
  | Float64Array;

export interface RasterImage {
  readonly bandPixels: ReadonlyArray<RasterTypedArray>;
  readonly width: number;
  readonly height: number;
  readonly bitsPerSample: number;
  readonly sampleFormat: RasterSampleFormat;
  readonly bandCount: number;
  readonly bandLabels?: ReadonlyArray<string>;
  readonly bandWavelengths?: ReadonlyArray<number>;
  readonly bandOriginalNumbers?: ReadonlyArray<number>;
  readonly sourceInterleave?: RasterSourceInterleave;
  readonly colorInterpretation?: RasterColorInterpretation;
}

export function cloneRasterImage(raster: RasterImage): RasterImage {
  return {
    ...raster,
    bandPixels: raster.bandPixels.map(copyRasterTypedArray),
    bandLabels: raster.bandLabels ? [...raster.bandLabels] : undefined,
    bandWavelengths: raster.bandWavelengths ? [...raster.bandWavelengths] : undefined,
    bandOriginalNumbers: raster.bandOriginalNumbers ? [...raster.bandOriginalNumbers] : undefined,
  };
}

export function getRasterBandPixelsOrThrow(
  raster: RasterImage,
  bandIndex: number,
): RasterTypedArray {
  const pixels = raster.bandPixels[bandIndex];
  if (!pixels) {
    throw new Error(
      `Band index ${bandIndex} out of range for raster with ${raster.bandCount} bands`,
    );
  }
  return pixels;
}

export function getRasterBandExplicitLabelOrNull(
  raster: RasterImage,
  bandIndex: number,
): string | null {
  const explicit = raster.bandLabels?.[bandIndex];
  if (explicit && explicit.length > 0) return explicit;
  return null;
}

export function getRasterBandLabelOrDefault(
  raster: RasterImage,
  bandIndex: number,
): string {
  return describeRasterBandDisplayIdentity(raster, bandIndex).label;
}

export interface RasterBandDisplayIdentity {
  readonly label: string;
  readonly originalNumber: number;
  readonly hasExplicitLabel: boolean;
}

export function describeRasterBandDisplayIdentity(
  raster: RasterImage,
  bandIndex: number,
): RasterBandDisplayIdentity {
  const explicitLabel = getRasterBandExplicitLabelOrNull(raster, bandIndex);
  const originalNumber = getRasterBandOriginalNumber(raster, bandIndex);
  return {
    label: explicitLabel ?? `Band ${originalNumber}`,
    originalNumber,
    hasExplicitLabel: explicitLabel !== null,
  };
}

export function formatRasterBandIdentityText(
  raster: RasterImage,
  bandIndex: number,
): string {
  const identity = describeRasterBandDisplayIdentity(raster, bandIndex);
  if (identity.hasExplicitLabel) return `#${identity.originalNumber} ${identity.label}`;
  return identity.label;
}

export function getRasterBandOriginalNumber(
  raster: RasterImage,
  bandIndex: number,
): number {
  return raster.bandOriginalNumbers?.[bandIndex] ?? bandIndex + 1;
}

export function listRasterBandOriginalNumbers(
  raster: RasterImage,
): ReadonlyArray<number> {
  return Array.from({ length: raster.bandCount }, (_, index) =>
    getRasterBandOriginalNumber(raster, index),
  );
}

export function clampBandIndexToRaster(
  raster: RasterImage,
  bandIndex: number,
): number {
  if (bandIndex < 0) return 0;
  if (bandIndex >= raster.bandCount) return raster.bandCount - 1;
  return bandIndex;
}

function copyRasterTypedArray(source: RasterTypedArray): RasterTypedArray {
  const Constructor = source.constructor as new (length: number) => RasterTypedArray;
  const copy = new Constructor(source.length);
  copy.set(source as never);
  return copy;
}
