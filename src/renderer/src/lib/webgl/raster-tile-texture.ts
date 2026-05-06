import type { RasterImage, RasterTypedArray } from "@/lib/image/raster-image";
import type { RasterTile } from "@/lib/webgl/raster-tile-splitter";

const HALF_FLOAT_COLOR_BUFFER_EXTENSION_NAME = "EXT_color_buffer_half_float";

export interface RasterTileTexture {
  readonly texture: WebGLTexture;
  readonly imageSpaceX: number;
  readonly imageSpaceY: number;
  readonly width: number;
  readonly height: number;
}

export function probeHalfFloatColorBufferExtension(
  gl: WebGL2RenderingContext,
): boolean {
  return gl.getExtension(HALF_FLOAT_COLOR_BUFFER_EXTENSION_NAME) !== null;
}

export function createR16FTextureForRasterTile(
  gl: WebGL2RenderingContext,
  tile: RasterTile,
  raster: RasterImage,
): RasterTileTexture {
  const texture = createR16FTextureBoundForSingleChannelSampling(gl, tile.width, tile.height);
  const floatPixels = convertRasterTilePixelsToNormalizedFloat32(tile.pixels, raster);
  uploadFloatPixelsToBoundR16FTexture(gl, floatPixels, tile.width, tile.height);
  return {
    texture,
    imageSpaceX: tile.x,
    imageSpaceY: tile.y,
    width: tile.width,
    height: tile.height,
  };
}

function createR16FTextureBoundForSingleChannelSampling(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error("Failed to create R16F WebGL texture");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  configureR16FTextureSamplingParameters(gl);
  reserveR16FTextureStorage(gl, width, height);
  return texture;
}

function configureR16FTextureSamplingParameters(gl: WebGL2RenderingContext): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function reserveR16FTextureStorage(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): void {
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R16F, width, height);
}

function uploadFloatPixelsToBoundR16FTexture(
  gl: WebGL2RenderingContext,
  pixels: Float32Array,
  width: number,
  height: number,
): void {
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RED, gl.FLOAT, pixels);
}

function convertRasterTilePixelsToNormalizedFloat32(
  pixels: RasterTypedArray,
  raster: RasterImage,
): Float32Array {
  if (raster.sampleFormat === "float") {
    return copyFloatPixelsAsFloat32(pixels);
  }
  return convertIntegerPixelsToFloat32WithUnitScale(pixels, raster.bitsPerSample);
}

function copyFloatPixelsAsFloat32(pixels: RasterTypedArray): Float32Array {
  const out = new Float32Array(pixels.length);
  out.set(pixels as never);
  return out;
}

function convertIntegerPixelsToFloat32WithUnitScale(
  pixels: RasterTypedArray,
  bitsPerSample: number,
): Float32Array {
  const scale = chooseUnitScaleForIntegerBitsPerSample(bitsPerSample);
  const out = new Float32Array(pixels.length);
  for (let i = 0; i < pixels.length; i++) {
    out[i] = (pixels[i] ?? 0) * scale;
  }
  return out;
}

function chooseUnitScaleForIntegerBitsPerSample(bitsPerSample: number): number {
  if (bitsPerSample <= 0) return 1;
  return 1 / (Math.pow(2, bitsPerSample) - 1);
}

export function deleteRasterTileTexturesSafely(
  gl: WebGL2RenderingContext,
  tiles: ReadonlyArray<RasterTileTexture>,
): void {
  for (const tile of tiles) {
    gl.deleteTexture(tile.texture);
  }
}
