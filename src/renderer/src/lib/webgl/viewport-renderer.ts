// Raw WebGL2 backing for the Viewport. Chosen over regl/twgl to keep deps
// minimal and to give later stages direct control over uniforms (CT-011 onward).

import {
  VIEWPORT_PASS_THROUGH_FRAGMENT_SHADER_SOURCE,
  VIEWPORT_VERTEX_SHADER_SOURCE,
  compileShaderOrThrow,
  linkProgramOrThrow,
} from "./shaders";
import {
  createTextureFromSource,
  deleteTextureSafely,
  type ViewportImageSource,
} from "./texture";

const POSITION_ATTRIBUTE_LOCATION = 0;
const TEXCOORD_ATTRIBUTE_LOCATION = 1;
const VERTEX_FLOAT_COUNT = 4;
const VERTEX_STRIDE_BYTES = VERTEX_FLOAT_COUNT * Float32Array.BYTES_PER_ELEMENT;
const TEXCOORD_OFFSET_BYTES = 2 * Float32Array.BYTES_PER_ELEMENT;

const FULLSCREEN_TEXTURED_QUAD_VERTICES = new Float32Array([
  -1, -1, 0, 1,
  1, -1, 1, 1,
  -1, 1, 0, 0,
  1, 1, 1, 0,
]);

interface RendererProgramResources {
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  vertexBuffer: WebGLBuffer;
}

export class ViewportRenderer {
  private gl: WebGL2RenderingContext | null = null;
  private programResources: RendererProgramResources | null = null;
  private texture: WebGLTexture | null = null;
  private currentSource: ViewportImageSource | null = null;
  private readonly handleContextLost = (event: Event): void =>
    this.respondToContextLost(event);
  private readonly handleContextRestored = (): void =>
    this.respondToContextRestored();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.attachContextLifecycleListeners();
    this.initializeWebGl();
  }

  setImageSource(source: ViewportImageSource): void {
    this.currentSource = source;
    this.uploadCurrentSourceIfReady();
    this.draw();
  }

  resizeToDisplaySize(displayWidthPx: number, displayHeightPx: number): void {
    syncCanvasBackingResolution(this.canvas, displayWidthPx, displayHeightPx);
    this.applyViewportToCanvasSize();
    this.draw();
  }

  dispose(): void {
    this.detachContextLifecycleListeners();
    this.releaseAllWebGlResources();
  }

  private attachContextLifecycleListeners(): void {
    this.canvas.addEventListener("webglcontextlost", this.handleContextLost, false);
    this.canvas.addEventListener(
      "webglcontextrestored",
      this.handleContextRestored,
      false,
    );
  }

  private detachContextLifecycleListeners(): void {
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.removeEventListener(
      "webglcontextrestored",
      this.handleContextRestored,
    );
  }

  private initializeWebGl(): void {
    const gl = this.canvas.getContext("webgl2", {
      antialias: false,
      premultipliedAlpha: false,
    });
    if (!gl) {
      console.warn("[viewport] WebGL2 unavailable; viewport will be blank.");
      return;
    }
    this.gl = gl;
    this.programResources = createViewportRendererProgram(gl);
    this.applyViewportToCanvasSize();
    this.uploadCurrentSourceIfReady();
    this.draw();
  }

  private respondToContextLost(event: Event): void {
    event.preventDefault();
    this.programResources = null;
    this.texture = null;
    this.gl = null;
    console.warn("[viewport] WebGL context lost");
  }

  private respondToContextRestored(): void {
    console.info("[viewport] WebGL context restored; reinitializing.");
    this.initializeWebGl();
  }

  private uploadCurrentSourceIfReady(): void {
    if (!this.gl || !this.currentSource) return;
    deleteTextureSafely(this.gl, this.texture);
    this.texture = createTextureFromSource(this.gl, this.currentSource);
  }

  private applyViewportToCanvasSize(): void {
    if (!this.gl) return;
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  private draw(): void {
    const { gl, programResources, texture } = this;
    if (!gl || !programResources) return;
    clearCanvasToTransparentBlack(gl);
    if (!texture) return;
    drawTexturedFullscreenQuad(gl, programResources, texture);
  }

  private releaseAllWebGlResources(): void {
    if (!this.gl) return;
    deleteTextureSafely(this.gl, this.texture);
    deleteRendererProgramResources(this.gl, this.programResources);
    this.texture = null;
    this.programResources = null;
    this.gl = null;
  }
}

function syncCanvasBackingResolution(
  canvas: HTMLCanvasElement,
  displayWidthPx: number,
  displayHeightPx: number,
): void {
  const dpr = window.devicePixelRatio || 1;
  const targetWidth = Math.max(1, Math.floor(displayWidthPx * dpr));
  const targetHeight = Math.max(1, Math.floor(displayHeightPx * dpr));
  if (canvas.width !== targetWidth) canvas.width = targetWidth;
  if (canvas.height !== targetHeight) canvas.height = targetHeight;
}

function clearCanvasToTransparentBlack(gl: WebGL2RenderingContext): void {
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

function drawTexturedFullscreenQuad(
  gl: WebGL2RenderingContext,
  resources: RendererProgramResources,
  texture: WebGLTexture,
): void {
  gl.useProgram(resources.program);
  gl.bindVertexArray(resources.vao);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindVertexArray(null);
}

function createViewportRendererProgram(
  gl: WebGL2RenderingContext,
): RendererProgramResources {
  const program = compileAndLinkPassThroughProgram(gl);
  const vertexBuffer = createFullscreenQuadVertexBuffer(gl);
  const vao = createFullscreenQuadVertexArray(gl, vertexBuffer);
  bindTextureSamplerToUnitZero(gl, program);
  return { program, vao, vertexBuffer };
}

function compileAndLinkPassThroughProgram(
  gl: WebGL2RenderingContext,
): WebGLProgram {
  const vertexShader = compileShaderOrThrow(
    gl,
    gl.VERTEX_SHADER,
    VIEWPORT_VERTEX_SHADER_SOURCE,
  );
  const fragmentShader = compileShaderOrThrow(
    gl,
    gl.FRAGMENT_SHADER,
    VIEWPORT_PASS_THROUGH_FRAGMENT_SHADER_SOURCE,
  );
  const program = linkProgramOrThrow(gl, vertexShader, fragmentShader);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  return program;
}

function createFullscreenQuadVertexBuffer(
  gl: WebGL2RenderingContext,
): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error("Failed to create vertex buffer");
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    FULLSCREEN_TEXTURED_QUAD_VERTICES,
    gl.STATIC_DRAW,
  );
  return buffer;
}

function createFullscreenQuadVertexArray(
  gl: WebGL2RenderingContext,
  vertexBuffer: WebGLBuffer,
): WebGLVertexArrayObject {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error("Failed to create vertex array object");
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  configureFullscreenQuadVertexAttributes(gl);
  gl.bindVertexArray(null);
  return vao;
}

function configureFullscreenQuadVertexAttributes(
  gl: WebGL2RenderingContext,
): void {
  enableInterleavedFloat2Attribute(gl, POSITION_ATTRIBUTE_LOCATION, 0);
  enableInterleavedFloat2Attribute(
    gl,
    TEXCOORD_ATTRIBUTE_LOCATION,
    TEXCOORD_OFFSET_BYTES,
  );
}

function enableInterleavedFloat2Attribute(
  gl: WebGL2RenderingContext,
  location: number,
  offsetBytes: number,
): void {
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(
    location,
    2,
    gl.FLOAT,
    false,
    VERTEX_STRIDE_BYTES,
    offsetBytes,
  );
}

function bindTextureSamplerToUnitZero(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
): void {
  const samplerLocation = gl.getUniformLocation(program, "u_texture");
  if (!samplerLocation) return;
  gl.useProgram(program);
  gl.uniform1i(samplerLocation, 0);
  gl.useProgram(null);
}

function deleteRendererProgramResources(
  gl: WebGL2RenderingContext,
  resources: RendererProgramResources | null,
): void {
  if (!resources) return;
  gl.deleteProgram(resources.program);
  gl.deleteVertexArray(resources.vao);
  gl.deleteBuffer(resources.vertexBuffer);
}
