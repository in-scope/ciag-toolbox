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
uniform bool u_normalizeEnabled;
uniform vec3 u_normalizeMinColor;
uniform vec3 u_normalizeMaxColor;
out vec4 outColor;
void main() {
  vec4 sampled = texture(u_texture, v_texCoord);
  vec3 rgb = sampled.rgb;
  if (u_normalizeEnabled) {
    // Per-band stretch to [0, 1]. For flat bands (max == min) we substitute
    // a divisor of 1; the numerator is also 0 in that case, so the result is 0.
    vec3 range = u_normalizeMaxColor - u_normalizeMinColor;
    bvec3 hasRange = greaterThan(range, vec3(0.0));
    vec3 safeRange = mix(vec3(1.0), range, hasRange);
    rgb = clamp((rgb - u_normalizeMinColor) / safeRange, 0.0, 1.0);
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
