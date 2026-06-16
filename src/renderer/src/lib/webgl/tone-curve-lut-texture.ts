// CT-170: a single-channel 1-D lookup texture the display shader samples to remap
// a band through a tone curve without re-baking pixel data. Stored as an
// N x 1 R8 texture with LINEAR filtering so the shader interpolates between
// entries; N = 1024 gives ample input resolution and 8-bit output is within
// 1 LSB at display time. The values are display-normalized [0, 1]
// (buildDisplayNormalizedToneCurveLookupTable), matching the sampled band value.

const TONE_CURVE_LUT_HEIGHT = 1;
const DISPLAY_UNIT_MAX_BYTE = 255;

export const TONE_CURVE_LUT_ENTRY_COUNT = 1024;

export function createIdentityToneCurveLutTexture(
  gl: WebGL2RenderingContext,
): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error("Failed to create tone-curve LUT texture");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  configureToneCurveLutSamplingParameters(gl);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, TONE_CURVE_LUT_ENTRY_COUNT, TONE_CURVE_LUT_HEIGHT);
  uploadNormalizedValuesToBoundToneCurveLut(gl, buildIdentityNormalizedLutValues());
  return texture;
}

export function uploadNormalizedValuesToToneCurveLutTexture(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  normalizedValues: ReadonlyArray<number>,
): void {
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  uploadNormalizedValuesToBoundToneCurveLut(gl, normalizedValues);
}

function configureToneCurveLutSamplingParameters(gl: WebGL2RenderingContext): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function uploadNormalizedValuesToBoundToneCurveLut(
  gl: WebGL2RenderingContext,
  normalizedValues: ReadonlyArray<number>,
): void {
  const bytes = packNormalizedValuesAsUint8(normalizedValues);
  gl.texSubImage2D(
    gl.TEXTURE_2D, 0, 0, 0, bytes.length, TONE_CURVE_LUT_HEIGHT, gl.RED, gl.UNSIGNED_BYTE, bytes,
  );
}

function buildIdentityNormalizedLutValues(): ReadonlyArray<number> {
  const lastEntryIndex = TONE_CURVE_LUT_ENTRY_COUNT - 1;
  return Array.from({ length: TONE_CURVE_LUT_ENTRY_COUNT }, (_unused, index) => index / lastEntryIndex);
}

function packNormalizedValuesAsUint8(values: ReadonlyArray<number>): Uint8Array {
  const bytes = new Uint8Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    bytes[index] = Math.round(clampToUnitInterval(values[index] ?? 0) * DISPLAY_UNIT_MAX_BYTE);
  }
  return bytes;
}

function clampToUnitInterval(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
