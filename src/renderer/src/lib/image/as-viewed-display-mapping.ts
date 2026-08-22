import {
  computeImageRgbChannelExtents,
} from "@/lib/image/compute-image-channel-extents";
import {
  computeRasterSampleDisplayMapping,
  mapRasterSampleToDisplayValue,
  type RasterSampleDisplayMapping,
} from "@/lib/image/data-type-display-range";
import {
  getRasterBandPixelsOrThrow,
  type RasterImage,
  type RasterTypedArray,
} from "@/lib/image/raster-image";
import { shouldRenderRasterAsRgbComposite } from "@/lib/image/raster-color-interpretation";
import {
  floatSourceDataFallsOutsideUnitDisplayWindow,
  mapSampleThroughDisplayNormalization,
  quantizeDisplayUnitToByte,
  resolveEffectiveFloatDisplayNormalization,
  type NormalizationState,
} from "@/lib/webgl/float-display-normalization";
import type { ViewportImageSource } from "@/lib/webgl/texture";

// CT-296: PNG and JPEG exports save the image AS VIEWED, so they run the same
// display mapping the renderer runs rather than dumping raw band values into
// 8-bit pixels. The stages mirror the viewport exactly: the raster sample is
// mapped to the value the renderer UPLOADS (integer bands pre-scaled over their
// data-type range, float bands raw), the effective normalization is resolved
// from the panel's display state (explicit normalized viewing, or the CT-161
// float auto-fit unless the CT-193 fixed window pins it), and the shader's
// normalize/clamp block runs per channel before quantizing to a byte.
//
// Data formats (TIFF, ENVI, 16-bit PNG) never come through here - they write
// raw data and must stay byte-identical.

// The display state of the panel being saved (ViewportRenderingState's display
// fields). Nothing here is data: both toggles are display-only.
export interface ViewportDisplayMappingState {
  readonly normalizationEnabled: boolean;
  readonly floatDisplayUsesFixedUnitWindow: boolean;
}

export const DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE: ViewportDisplayMappingState = {
  normalizationEnabled: false,
  floatDisplayUsesFixedUnitWindow: false,
};

const RGBA_BYTES_PER_PIXEL = 4;
const OPAQUE_ALPHA = 0xff;
const RGB_CHANNEL_INDEXES = [0, 1, 2] as const;

export function resolveAsViewedNormalizationForSource(
  source: ViewportImageSource,
  selectedBandIndex: number,
  displayState: ViewportDisplayMappingState,
): NormalizationState {
  const extents = computeImageRgbChannelExtents(source, selectedBandIndex);
  return resolveEffectiveFloatDisplayNormalization(
    { enabled: displayState.normalizationEnabled, extents },
    floatSourceDataFallsOutsideUnitDisplayWindow(source, extents),
    displayState.floatDisplayUsesFixedUnitWindow,
  );
}

export function buildAsViewedRgbaBytesFromRaster(
  raster: RasterImage,
  selectedBandIndex: number,
  displayState: ViewportDisplayMappingState,
): Uint8ClampedArray {
  const normalization = resolveAsViewedNormalizationForSource(
    { kind: "raster", raster },
    selectedBandIndex,
    displayState,
  );
  if (shouldRenderRasterAsRgbComposite(raster)) {
    return buildAsViewedCompositeRgbaBytes(raster, normalization);
  }
  return buildAsViewedGrayscaleRgbaBytes(raster, selectedBandIndex, normalization);
}

function buildAsViewedCompositeRgbaBytes(
  raster: RasterImage,
  normalization: NormalizationState,
): Uint8ClampedArray {
  const mapping = computeRasterSampleDisplayMapping(raster);
  const channels = RGB_CHANNEL_INDEXES.map((index) => getRasterBandPixelsOrThrow(raster, index));
  const rgba = createOpaqueRgbaBytes(raster.width * raster.height);
  for (const channelIndex of RGB_CHANNEL_INDEXES) {
    fillOneChannelAsViewed(rgba, channels[channelIndex]!, channelIndex, mapping, normalization);
  }
  return rgba;
}

function buildAsViewedGrayscaleRgbaBytes(
  raster: RasterImage,
  bandIndex: number,
  normalization: NormalizationState,
): Uint8ClampedArray {
  const pixels = getRasterBandPixelsOrThrow(raster, bandIndex);
  const mapping = computeRasterSampleDisplayMapping(raster);
  const rgba = createOpaqueRgbaBytes(raster.width * raster.height);
  for (const channelIndex of RGB_CHANNEL_INDEXES) {
    fillOneChannelAsViewed(rgba, pixels, channelIndex, mapping, normalization);
  }
  return rgba;
}

// The shader replicates a single band across R, G and B, and each channel of a
// composite carries its own extents, so one filler serves both by taking the
// channel index it writes and reads its extents from.
function fillOneChannelAsViewed(
  rgba: Uint8ClampedArray,
  pixels: RasterTypedArray,
  channelIndex: number,
  mapping: RasterSampleDisplayMapping,
  normalization: NormalizationState,
): void {
  for (let pixelIndex = 0; pixelIndex < pixels.length; pixelIndex += 1) {
    const sample = mapRasterSampleToDisplayValue(pixels[pixelIndex] ?? 0, mapping);
    const displayed = mapSampleThroughDisplayNormalization(sample, channelIndex, normalization);
    rgba[pixelIndex * RGBA_BYTES_PER_PIXEL + channelIndex] = quantizeDisplayUnitToByte(displayed);
  }
}

function createOpaqueRgbaBytes(pixelCount: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(pixelCount * RGBA_BYTES_PER_PIXEL);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    rgba[pixelIndex * RGBA_BYTES_PER_PIXEL + 3] = OPAQUE_ALPHA;
  }
  return rgba;
}

// A browser-image source already holds display-unit bytes, so only the
// normalize/clamp block applies; with normalization off the bytes pass through
// untouched, which is why this returns the same array it was given.
export function mapRgbaBytesThroughDisplayNormalizationInPlace(
  rgba: Uint8ClampedArray,
  normalization: NormalizationState,
): Uint8ClampedArray {
  if (!normalization.enabled) return rgba;
  for (let offset = 0; offset < rgba.length; offset += RGBA_BYTES_PER_PIXEL) {
    mapOnePixelThroughDisplayNormalization(rgba, offset, normalization);
  }
  return rgba;
}

function mapOnePixelThroughDisplayNormalization(
  rgba: Uint8ClampedArray,
  offset: number,
  normalization: NormalizationState,
): void {
  for (const channelIndex of RGB_CHANNEL_INDEXES) {
    const sample = (rgba[offset + channelIndex] ?? 0) / 0xff;
    const displayed = mapSampleThroughDisplayNormalization(sample, channelIndex, normalization);
    rgba[offset + channelIndex] = quantizeDisplayUnitToByte(displayed);
  }
}
