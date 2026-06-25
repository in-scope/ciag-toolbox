export const VIEWPORT_VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_texCoord;
uniform vec2 u_quadScale;
uniform vec2 u_quadTranslate;
out vec2 v_texCoord;
void main() {
  v_texCoord = a_texCoord;
  vec2 transformed = a_position * u_quadScale + u_quadTranslate;
  gl_Position = vec4(transformed, 0.0, 1.0);
}
`;

export const VIEWPORT_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform bool u_isSingleBand;
uniform bool u_normalizeEnabled;
uniform vec3 u_normalizeMinColor;
uniform vec3 u_normalizeMaxColor;
uniform bool u_toneCurveEnabled;
uniform bool u_toneCurveMultiChannel;
uniform bool u_toneCurveRemapsSampleDomain;
uniform float u_toneCurveSampleDomainMin;
uniform float u_toneCurveSampleDomainMax;
uniform sampler2D u_toneCurveLut;
uniform sampler2D u_toneCurveLutGreen;
uniform sampler2D u_toneCurveLutBlue;
out vec4 outColor;
// CT-198: a float band uploads RAW (unscaled) values, so its tone-curve LUT is built
// over the band's actual value range [dataMin, dataMax] (the curve anchor domain), not
// the fixed [0, 1] window. Map the raw sample into that domain to find the texture
// coordinate, then map the display-normalized LUT output back to a raw value so the
// downstream normalize/clamp block reproduces the no-curve display for an identity
// curve. Integer/composite paths leave the flag off and sample the LUT directly.
float sampleToneCurveLutInSampleDomain(float value) {
  float span = u_toneCurveSampleDomainMax - u_toneCurveSampleDomainMin;
  if (!u_toneCurveRemapsSampleDomain || span <= 0.0) {
    return texture(u_toneCurveLut, vec2(value, 0.5)).r;
  }
  float coord = clamp((value - u_toneCurveSampleDomainMin) / span, 0.0, 1.0);
  return u_toneCurveSampleDomainMin + texture(u_toneCurveLut, vec2(coord, 0.5)).r * span;
}
vec3 remapThroughToneCurveLut(vec3 rgb) {
  // Each component is a display-unit value in [0, 1], so it doubles as the LUT
  // texture coordinate. The LUTs were built over the same display-normalized
  // domain (CT-170/CT-177). For a true-colour composite each channel samples its
  // OWN table (R/G/B), with the rgb/Value curve already folded into each on the
  // CPU; otherwise all three components share the single CT-171 LUT (CT-198 remaps
  // the sample domain for a raw-valued float band).
  if (u_toneCurveMultiChannel) {
    return vec3(
      texture(u_toneCurveLut, vec2(rgb.r, 0.5)).r,
      texture(u_toneCurveLutGreen, vec2(rgb.g, 0.5)).r,
      texture(u_toneCurveLutBlue, vec2(rgb.b, 0.5)).r
    );
  }
  return vec3(
    sampleToneCurveLutInSampleDomain(rgb.r),
    sampleToneCurveLutInSampleDomain(rgb.g),
    sampleToneCurveLutInSampleDomain(rgb.b)
  );
}
void main() {
  vec4 sampled = texture(u_texture, v_texCoord);
  vec3 rgb = u_isSingleBand ? vec3(sampled.r) : sampled.rgb;
  // Tone-curve remap happens BEFORE the normalize/display-stretch block so the
  // curve operates on raw display-unit values; the blocks below clamp as today.
  if (u_toneCurveEnabled) {
    rgb = remapThroughToneCurveLut(rgb);
  }
  if (u_normalizeEnabled) {
    // Per-band stretch to [0, 1]. For flat bands (max == min) we substitute
    // a divisor of 1; the numerator is also 0 in that case, so the result is 0.
    vec3 range = u_normalizeMaxColor - u_normalizeMinColor;
    bvec3 hasRange = greaterThan(range, vec3(0.0));
    vec3 safeRange = mix(vec3(1.0), range, hasRange);
    rgb = clamp((rgb - u_normalizeMinColor) / safeRange, 0.0, 1.0);
  } else {
    // Default display (CT-062): the data-type range is mapped to black-to-white.
    // Integer bands arrive pre-scaled to [0, 1]; float bands are clamped here so
    // values outside [0, 1] read as black/white rather than wrapping or relying
    // on the framebuffer to clamp.
    rgb = clamp(rgb, 0.0, 1.0);
  }
  outColor = vec4(rgb, sampled.a);
}
`;

export function compileShaderOrThrow(
  gl: WebGL2RenderingContext,
  shaderType: GLenum,
  source: string,
): WebGLShader {
  const shader = gl.createShader(shaderType);
  if (!shader) throw new Error("Failed to create WebGL shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  ensureShaderCompiledOrThrow(gl, shader);
  return shader;
}

function ensureShaderCompiledOrThrow(
  gl: WebGL2RenderingContext,
  shader: WebGLShader,
): void {
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return;
  const info = gl.getShaderInfoLog(shader) ?? "(no info log)";
  gl.deleteShader(shader);
  throw new Error(`Shader compilation failed: ${info}`);
}

export function linkProgramOrThrow(
  gl: WebGL2RenderingContext,
  vertexShader: WebGLShader,
  fragmentShader: WebGLShader,
): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error("Failed to create WebGL program");
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  ensureProgramLinkedOrThrow(gl, program);
  return program;
}

function ensureProgramLinkedOrThrow(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
): void {
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return;
  const info = gl.getProgramInfoLog(program) ?? "(no info log)";
  gl.deleteProgram(program);
  throw new Error(`WebGL program link failed: ${info}`);
}
