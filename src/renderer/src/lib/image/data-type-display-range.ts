import type { RasterImage, RasterSampleFormat } from "./raster-image";

// Default display scaling (CT-062): map a band's data-type range to the [0, 1]
// black-to-white display unit space. uint8 0..255 -> 0..1, uint16 0..65535 ->
// 0..1, signed ints by their type range (e.g. int16 -32768..32767 -> 0..1),
// float passes through unchanged (scale 1, offset 0) and is clamped to [0, 1]
// at display time. This is the scaling used when "Normalized viewing" is off,
// so a dim sub-range image (e.g. 12-bit data in a uint16 container) reads as
// dim and Bit Shift visibly brightens it instead of being auto-stretched.

export interface DataTypeUnitMapping {
  readonly scale: number;
  readonly offset: number;
}

const IDENTITY_FLOAT_UNIT_MAPPING: DataTypeUnitMapping = { scale: 1, offset: 0 };

export function computeDataTypeUnitMappingForRaster(
  raster: RasterImage,
): DataTypeUnitMapping {
  if (raster.sampleFormat === "float") return IDENTITY_FLOAT_UNIT_MAPPING;
  return computeIntegerDataTypeUnitMapping(raster.sampleFormat, raster.bitsPerSample);
}

export function mapRawValueToDisplayUnit(
  value: number,
  mapping: DataTypeUnitMapping,
): number {
  return clampToDisplayUnit(value * mapping.scale + mapping.offset);
}

export function clampToDisplayUnit(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function computeIntegerDataTypeUnitMapping(
  sampleFormat: RasterSampleFormat,
  bitsPerSample: number,
): DataTypeUnitMapping {
  const span = integerTypeValueSpan(bitsPerSample);
  const scale = 1 / span;
  if (sampleFormat === "int") {
    return { scale, offset: signedIntegerZeroOffset(bitsPerSample) / span };
  }
  return { scale, offset: 0 };
}

function integerTypeValueSpan(bitsPerSample: number): number {
  if (bitsPerSample <= 0) return 1;
  return Math.pow(2, bitsPerSample) - 1;
}

function signedIntegerZeroOffset(bitsPerSample: number): number {
  if (bitsPerSample <= 0) return 0;
  return Math.pow(2, bitsPerSample - 1);
}

// The value the renderer UPLOADS for one raster sample (src/renderer/src/lib/
// webgl/raster-tile-texture.ts): a float band uploads its raw value unscaled,
// an integer band is pre-scaled into the [0, 1] display window. Export paths
// that must reproduce the on-screen image share this mapping rather than
// re-deriving a scale factor of their own (CT-296).
export interface RasterSampleDisplayMapping {
  readonly passesSamplesThroughUnscaled: boolean;
  readonly unitMapping: DataTypeUnitMapping;
}

export function computeRasterSampleDisplayMapping(
  raster: RasterImage,
): RasterSampleDisplayMapping {
  return {
    passesSamplesThroughUnscaled: raster.sampleFormat === "float",
    unitMapping: computeDataTypeUnitMappingForRaster(raster),
  };
}

export function mapRasterSampleToDisplayValue(
  value: number,
  mapping: RasterSampleDisplayMapping,
): number {
  if (mapping.passesSamplesThroughUnscaled) return value;
  return mapRawValueToDisplayUnit(value, mapping.unitMapping);
}
