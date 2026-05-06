export type RasterSampleFormat = "uint" | "int" | "float";

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
}

export function cloneRasterImage(raster: RasterImage): RasterImage {
  return {
    ...raster,
    bandPixels: raster.bandPixels.map(copyRasterTypedArray),
    bandLabels: raster.bandLabels ? [...raster.bandLabels] : undefined,
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

export function getRasterBandLabelOrDefault(
  raster: RasterImage,
  bandIndex: number,
): string {
  const explicit = raster.bandLabels?.[bandIndex];
  if (explicit && explicit.length > 0) return explicit;
  return `Band ${bandIndex + 1}`;
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
