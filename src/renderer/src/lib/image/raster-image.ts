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
  readonly pixels: RasterTypedArray;
  readonly width: number;
  readonly height: number;
  readonly bitsPerSample: number;
  readonly sampleFormat: RasterSampleFormat;
  readonly bandCount: number;
}

export function cloneRasterImage(raster: RasterImage): RasterImage {
  return {
    ...raster,
    pixels: copyRasterTypedArray(raster.pixels),
  };
}

function copyRasterTypedArray(source: RasterTypedArray): RasterTypedArray {
  const Constructor = source.constructor as new (length: number) => RasterTypedArray;
  const copy = new Constructor(source.length);
  copy.set(source as never);
  return copy;
}
