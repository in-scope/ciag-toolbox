import type { RasterImage } from "@/lib/image/raster-image";

export type ViewportImageSource =
  | { kind: "html-image"; image: HTMLImageElement }
  | { kind: "image-bitmap"; image: ImageBitmap }
  | {
      kind: "pixels";
      pixels: Uint8ClampedArray | Uint8Array;
      width: number;
      height: number;
    }
  | { kind: "raster"; raster: RasterImage };

export function getImageSourceDimensions(source: ViewportImageSource): {
  width: number;
  height: number;
} {
  if (source.kind === "pixels") {
    return { width: source.width, height: source.height };
  }
  if (source.kind === "raster") {
    return { width: source.raster.width, height: source.raster.height };
  }
  return { width: source.image.width, height: source.image.height };
}

export function createTextureFromSource(
  gl: WebGL2RenderingContext,
  source: ViewportImageSource,
): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error("Failed to create WebGL texture");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  configureClampedLinearTextureParameters(gl);
  uploadSourceToBoundTexture(gl, source);
  return texture;
}

function configureClampedLinearTextureParameters(
  gl: WebGL2RenderingContext,
): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function uploadSourceToBoundTexture(
  gl: WebGL2RenderingContext,
  source: ViewportImageSource,
): void {
  if (source.kind === "pixels") {
    uploadPixelsToBoundTexture(gl, source.pixels, source.width, source.height);
    return;
  }
  if (source.kind === "raster") {
    uploadRasterAsGrayscaleRgbaToBoundTexture(gl, source.raster);
    return;
  }
  uploadDomImageToBoundTexture(gl, source.image);
}

function uploadPixelsToBoundTexture(
  gl: WebGL2RenderingContext,
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): void {
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    width,
    height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    pixels,
  );
}

function uploadRasterAsGrayscaleRgbaToBoundTexture(
  gl: WebGL2RenderingContext,
  raster: RasterImage,
): void {
  const rgba = convertRasterToGrayscaleRgbaBytes(raster);
  uploadPixelsToBoundTexture(gl, rgba, raster.width, raster.height);
}

function uploadDomImageToBoundTexture(
  gl: WebGL2RenderingContext,
  image: HTMLImageElement | ImageBitmap,
): void {
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
}

function convertRasterToGrayscaleRgbaBytes(
  raster: RasterImage,
): Uint8ClampedArray {
  const pixelCount = raster.width * raster.height;
  const rgba = new Uint8ClampedArray(pixelCount * 4);
  const toByte = chooseRasterValueToByteScaler(raster);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
    const value = toByte(raster.pixels[pixelIndex] ?? 0);
    writeOpaqueGrayPixelAtIndex(rgba, pixelIndex, value);
  }
  return rgba;
}

function writeOpaqueGrayPixelAtIndex(
  rgba: Uint8ClampedArray,
  pixelIndex: number,
  byteValue: number,
): void {
  const offset = pixelIndex * 4;
  rgba[offset] = byteValue;
  rgba[offset + 1] = byteValue;
  rgba[offset + 2] = byteValue;
  rgba[offset + 3] = 255;
}

function chooseRasterValueToByteScaler(
  raster: RasterImage,
): (value: number) => number {
  if (raster.sampleFormat === "float") return scaleFloatUnitToByte;
  return chooseIntegerScalerForBitsPerSample(raster.bitsPerSample);
}

function chooseIntegerScalerForBitsPerSample(
  bitsPerSample: number,
): (value: number) => number {
  if (bitsPerSample <= 8) return identityClampedToByte;
  const shift = bitsPerSample - 8;
  return (value: number) => clampToByte(value >>> shift);
}

function scaleFloatUnitToByte(value: number): number {
  return clampToByte(Math.round(value * 255));
}

function identityClampedToByte(value: number): number {
  return clampToByte(value);
}

function clampToByte(value: number): number {
  if (value < 0) return 0;
  if (value > 255) return 255;
  return value;
}

export function deleteTextureSafely(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture | null,
): void {
  if (!texture) return;
  gl.deleteTexture(texture);
}
