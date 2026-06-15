import type { RasterImage, RasterTypedArray } from "@/lib/image/raster-image";
import {
  computeDataTypeUnitMappingForRaster,
  mapRawValueToDisplayUnit,
} from "@/lib/image/data-type-display-range";
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
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
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

// CT-159: an RGB-composite raster uploads three aligned band tiles into one
// RGBA16F texture so the fragment shader samples real colour. The tiles share an
// identical rect (same splitter, same dimensions), so band index i lines up.
export function createRgbF16TextureForRasterTileTriple(
  gl: WebGL2RenderingContext,
  tiles: readonly [RasterTile, RasterTile, RasterTile],
  raster: RasterImage,
): RasterTileTexture {
  const [red] = tiles;
  const texture = createRgba16FTextureBoundForColorSampling(gl, red.width, red.height);
  const rgba = packRasterTileTripleAsNormalizedRgbaFloat32(tiles, raster);
  uploadFloatPixelsToBoundRgba16FTexture(gl, rgba, red.width, red.height);
  return { texture, imageSpaceX: red.x, imageSpaceY: red.y, width: red.width, height: red.height };
}

function createRgba16FTextureBoundForColorSampling(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error("Failed to create RGBA16F WebGL texture");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  configureR16FTextureSamplingParameters(gl);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, width, height);
  return texture;
}

function uploadFloatPixelsToBoundRgba16FTexture(
  gl: WebGL2RenderingContext,
  pixels: Float32Array,
  width: number,
  height: number,
): void {
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.FLOAT, pixels);
}

function packRasterTileTripleAsNormalizedRgbaFloat32(
  tiles: readonly [RasterTile, RasterTile, RasterTile],
  raster: RasterImage,
): Float32Array {
  const red = convertRasterTilePixelsToNormalizedFloat32(tiles[0].pixels, raster);
  const green = convertRasterTilePixelsToNormalizedFloat32(tiles[1].pixels, raster);
  const blue = convertRasterTilePixelsToNormalizedFloat32(tiles[2].pixels, raster);
  return interleaveRgbChannelsAsOpaqueRgbaFloat32(red, green, blue);
}

function interleaveRgbChannelsAsOpaqueRgbaFloat32(
  red: Float32Array,
  green: Float32Array,
  blue: Float32Array,
): Float32Array {
  const rgba = new Float32Array(red.length * 4);
  for (let pixelIndex = 0; pixelIndex < red.length; pixelIndex += 1) {
    const offset = pixelIndex * 4;
    rgba[offset] = red[pixelIndex] ?? 0;
    rgba[offset + 1] = green[pixelIndex] ?? 0;
    rgba[offset + 2] = blue[pixelIndex] ?? 0;
    rgba[offset + 3] = 1;
  }
  return rgba;
}

function convertRasterTilePixelsToNormalizedFloat32(
  pixels: RasterTypedArray,
  raster: RasterImage,
): Float32Array {
  if (raster.sampleFormat === "float") {
    return copyFloatPixelsAsFloat32(pixels);
  }
  return convertIntegerPixelsToDisplayUnitFloat32(pixels, raster);
}

function copyFloatPixelsAsFloat32(pixels: RasterTypedArray): Float32Array {
  const out = new Float32Array(pixels.length);
  out.set(pixels as never);
  return out;
}

function convertIntegerPixelsToDisplayUnitFloat32(
  pixels: RasterTypedArray,
  raster: RasterImage,
): Float32Array {
  const mapping = computeDataTypeUnitMappingForRaster(raster);
  const out = new Float32Array(pixels.length);
  for (let i = 0; i < pixels.length; i++) {
    out[i] = mapRawValueToDisplayUnit(pixels[i] ?? 0, mapping);
  }
  return out;
}

export function deleteRasterTileTexturesSafely(
  gl: WebGL2RenderingContext,
  tiles: ReadonlyArray<RasterTileTexture>,
): void {
  for (const tile of tiles) {
    gl.deleteTexture(tile.texture);
  }
}
