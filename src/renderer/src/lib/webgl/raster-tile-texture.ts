import type { RasterImage, RasterTypedArray } from "@/lib/image/raster-image";
import {
  computeRasterSampleDisplayMapping,
  mapRasterSampleToDisplayValue,
} from "@/lib/image/data-type-display-range";
import type { RasterTile } from "@/lib/webgl/raster-tile-splitter";

const HALF_FLOAT_COLOR_BUFFER_EXTENSION_NAME = "EXT_color_buffer_half_float";
const FLOAT_LINEAR_FILTERING_EXTENSION_NAME = "OES_texture_float_linear";

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

export function createSingleBandTextureForRasterTile(
  gl: WebGL2RenderingContext,
  tile: RasterTile,
  raster: RasterImage,
): RasterTileTexture {
  const storage = chooseSingleBandTileStorage(gl, raster);
  const texture = createTileTextureBoundForSampling(gl, tile.width, tile.height, storage);
  const floatPixels = convertRasterTilePixelsToUploadFloat32(tile.pixels, raster);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, tile.width, tile.height, gl.RED, gl.FLOAT, floatPixels);
  return {
    texture,
    imageSpaceX: tile.x,
    imageSpaceY: tile.y,
    width: tile.width,
    height: tile.height,
  };
}

interface TileTextureStorage {
  readonly internalFormat: GLenum;
  readonly minFilter: GLenum;
}

// A float raster's band pixels upload RAW (unscaled), and PCA/MNF components or
// band-math results routinely exceed half-float's ~65504 max finite value, which
// binarized the display (the venere PCA field regression). Float tiles therefore
// take lossless float32 storage. Integer tiles are pre-scaled to [0,1], always in
// range, and keep the cheaper half-float storage.
function chooseSingleBandTileStorage(
  gl: WebGL2RenderingContext,
  raster: RasterImage,
): TileTextureStorage {
  if (raster.sampleFormat !== "float") return { internalFormat: gl.R16F, minFilter: gl.LINEAR };
  return { internalFormat: gl.R32F, minFilter: chooseFloat32MinificationFilter(gl) };
}

function chooseRgbCompositeTileStorage(
  gl: WebGL2RenderingContext,
  raster: RasterImage,
): TileTextureStorage {
  if (raster.sampleFormat !== "float") return { internalFormat: gl.RGBA16F, minFilter: gl.LINEAR };
  return { internalFormat: gl.RGBA32F, minFilter: chooseFloat32MinificationFilter(gl) };
}

// LINEAR minification of float32 textures requires OES_texture_float_linear
// (ubiquitous on desktop GL); without it fall back to NEAREST, matching the
// magnification filter, rather than leaving the texture incomplete.
function chooseFloat32MinificationFilter(gl: WebGL2RenderingContext): GLenum {
  const supportsLinear = gl.getExtension(FLOAT_LINEAR_FILTERING_EXTENSION_NAME) !== null;
  return supportsLinear ? gl.LINEAR : gl.NEAREST;
}

function createTileTextureBoundForSampling(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  storage: TileTextureStorage,
): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error("Failed to create raster tile WebGL texture");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  configureTileTextureSamplingParameters(gl, storage.minFilter);
  gl.texStorage2D(gl.TEXTURE_2D, 1, storage.internalFormat, width, height);
  return texture;
}

function configureTileTextureSamplingParameters(
  gl: WebGL2RenderingContext,
  minFilter: GLenum,
): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

// CT-159: an RGB-composite raster uploads three aligned band tiles into one
// RGBA texture so the fragment shader samples real colour. The tiles share an
// identical rect (same splitter, same dimensions), so band index i lines up.
export function createRgbCompositeTextureForRasterTileTriple(
  gl: WebGL2RenderingContext,
  tiles: readonly [RasterTile, RasterTile, RasterTile],
  raster: RasterImage,
): RasterTileTexture {
  const [red] = tiles;
  const storage = chooseRgbCompositeTileStorage(gl, raster);
  const texture = createTileTextureBoundForSampling(gl, red.width, red.height, storage);
  const rgba = packRasterTileTripleAsUploadRgbaFloat32(tiles, raster);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, red.width, red.height, gl.RGBA, gl.FLOAT, rgba);
  return { texture, imageSpaceX: red.x, imageSpaceY: red.y, width: red.width, height: red.height };
}

function packRasterTileTripleAsUploadRgbaFloat32(
  tiles: readonly [RasterTile, RasterTile, RasterTile],
  raster: RasterImage,
): Float32Array {
  const red = convertRasterTilePixelsToUploadFloat32(tiles[0].pixels, raster);
  const green = convertRasterTilePixelsToUploadFloat32(tiles[1].pixels, raster);
  const blue = convertRasterTilePixelsToUploadFloat32(tiles[2].pixels, raster);
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

function convertRasterTilePixelsToUploadFloat32(
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
  const mapping = computeRasterSampleDisplayMapping(raster);
  const out = new Float32Array(pixels.length);
  for (let i = 0; i < pixels.length; i++) {
    out[i] = mapRasterSampleToDisplayValue(pixels[i] ?? 0, mapping);
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
