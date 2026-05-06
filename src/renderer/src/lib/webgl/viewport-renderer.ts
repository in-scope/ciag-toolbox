// Raw WebGL2 backing for the Viewport. Chosen over regl/twgl to keep deps
// minimal and to give later stages direct control over uniforms (CT-011 onward).

import {
  VIEWPORT_FRAGMENT_SHADER_SOURCE,
  VIEWPORT_VERTEX_SHADER_SOURCE,
  compileShaderOrThrow,
  linkProgramOrThrow,
} from "./shaders";
import {
  createTextureFromBrowserSource,
  deleteTextureSafely,
  getImageSourceDimensions,
  type ViewportImageSource,
} from "./texture";
import {
  DEFAULT_RASTER_TILE_SIZE,
  splitRasterBandIntoTiles,
} from "./raster-tile-splitter";
import {
  createR16FTextureForRasterTile,
  deleteRasterTileTexturesSafely,
  probeHalfFloatColorBufferExtension,
  type RasterTileTexture,
} from "./raster-tile-texture";
import {
  composeTileQuadTransform,
  type QuadTransform,
} from "./tile-quad-transform";
import {
  IDENTITY_PAN,
  clampUserZoom,
  computeFitToViewportScale,
  computePanForZoomAtCursor,
  computeWheelZoomFactor,
  convertCanvasPointToClipSpace,
  convertPixelDeltaToClipDelta,
  type ClipPoint,
  type ViewportSize,
} from "./view-transform";
import {
  convertCanvasPixelToImagePixelOrNull,
  type ImagePixelPoint,
} from "./canvas-to-image-pixel";
import {
  IDENTITY_RGB_CHANNEL_EXTENTS,
  computeImageRgbChannelExtents,
  type RgbChannelExtents,
} from "@/lib/image/compute-image-channel-extents";
import {
  clampBandIndexToRaster,
  getRasterBandPixelsOrThrow,
  type RasterImage,
} from "@/lib/image/raster-image";

const POSITION_ATTRIBUTE_LOCATION = 0;
const TEXCOORD_ATTRIBUTE_LOCATION = 1;
const VERTEX_FLOAT_COUNT = 4;
const VERTEX_STRIDE_BYTES = VERTEX_FLOAT_COUNT * Float32Array.BYTES_PER_ELEMENT;
const INITIAL_USER_ZOOM = 1;
const FALLBACK_SIZE: ViewportSize = { width: 1, height: 1 };

const HALF_FLOAT_UNSUPPORTED_MESSAGE =
  "Half-float texture support (EXT_color_buffer_half_float) was not detected. " +
  "16-bit raster images may not display correctly on this hardware.";

const FULLSCREEN_TEXTURED_QUAD_VERTICES = new Float32Array([
  -1, -1, 0, 1,
  1, -1, 1, 1,
  -1, 1, 0, 0,
  1, 1, 1, 0,
]);

interface QuadTransformUniformLocations {
  quadScale: WebGLUniformLocation | null;
  quadTranslate: WebGLUniformLocation | null;
}

interface NormalizationUniformLocations {
  enabled: WebGLUniformLocation | null;
  minColor: WebGLUniformLocation | null;
  maxColor: WebGLUniformLocation | null;
}

interface BandModeUniformLocations {
  isSingleBand: WebGLUniformLocation | null;
}

interface ProgramUniformLocations {
  quadTransform: QuadTransformUniformLocations;
  normalization: NormalizationUniformLocations;
  bandMode: BandModeUniformLocations;
}

interface RendererProgramResources {
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  vertexBuffer: WebGLBuffer;
  uniforms: ProgramUniformLocations;
}

interface NormalizationState {
  enabled: boolean;
  extents: RgbChannelExtents;
}

interface RenderPassState {
  readonly normalization: NormalizationState;
  readonly isSingleBand: boolean;
}

export interface ViewportRendererOptions {
  readonly onError?: (message: string) => void;
}

export class ViewportRenderer {
  private gl: WebGL2RenderingContext | null = null;
  private programResources: RendererProgramResources | null = null;
  private singleTexture: WebGLTexture | null = null;
  private rasterTileTextures: RasterTileTexture[] = [];
  private currentSource: ViewportImageSource | null = null;
  private selectedRasterBandIndex = 0;
  private isSingleBandSource = false;
  private displaySize: ViewportSize = FALLBACK_SIZE;
  private imageSize: ViewportSize = FALLBACK_SIZE;
  private userZoom = INITIAL_USER_ZOOM;
  private userPan: ClipPoint = IDENTITY_PAN;
  private normalization: NormalizationState = {
    enabled: false,
    extents: IDENTITY_RGB_CHANNEL_EXTENTS,
  };
  private readonly handleContextLost = (event: Event): void =>
    this.respondToContextLost(event);
  private readonly handleContextRestored = (): void =>
    this.respondToContextRestored();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: ViewportRendererOptions = {},
  ) {
    this.attachContextLifecycleListeners();
    this.initializeWebGl();
  }

  setImageSource(source: ViewportImageSource, selectedBandIndex: number = 0): void {
    this.currentSource = source;
    this.selectedRasterBandIndex = clampBandIndexForSource(source, selectedBandIndex);
    this.imageSize = getImageSourceDimensions(source);
    this.isSingleBandSource = isSingleBandSourceWithSelectedBand(source);
    this.cacheNormalizationExtentsForSource(source);
    this.resetViewState();
    this.uploadCurrentSourceIfReady();
    this.draw();
  }

  setSelectedRasterBandIndex(bandIndex: number): void {
    if (!this.currentSource || this.currentSource.kind !== "raster") return;
    const clamped = clampBandIndexToRaster(this.currentSource.raster, bandIndex);
    if (clamped === this.selectedRasterBandIndex) return;
    this.selectedRasterBandIndex = clamped;
    this.cacheNormalizationExtentsForSource(this.currentSource);
    this.rebuildRasterTilesForSelectedBand();
    this.draw();
  }

  setNormalizationEnabled(enabled: boolean): void {
    if (this.normalization.enabled === enabled) return;
    this.normalization = { ...this.normalization, enabled };
    this.draw();
  }

  private cacheNormalizationExtentsForSource(source: ViewportImageSource): void {
    this.normalization = {
      enabled: this.normalization.enabled,
      extents: computeImageRgbChannelExtents(source, this.selectedRasterBandIndex),
    };
  }

  resizeToDisplaySize(displayWidthPx: number, displayHeightPx: number): void {
    this.displaySize = { width: displayWidthPx, height: displayHeightPx };
    syncCanvasBackingResolution(this.canvas, displayWidthPx, displayHeightPx);
    this.applyViewportToCanvasSize();
    this.draw();
  }

  panByPixels(deltaXPx: number, deltaYPx: number): void {
    const delta = convertPixelDeltaToClipDelta(
      deltaXPx,
      deltaYPx,
      this.displaySize,
    );
    this.userPan = { x: this.userPan.x + delta.x, y: this.userPan.y + delta.y };
    this.draw();
  }

  zoomAtCanvasPoint(xPx: number, yPx: number, wheelDeltaY: number): void {
    const factor = computeWheelZoomFactor(wheelDeltaY);
    const newZoom = clampUserZoom(this.userZoom * factor);
    if (newZoom === this.userZoom) return;
    const cursorClip = convertCanvasPointToClipSpace(xPx, yPx, this.displaySize);
    this.userPan = computePanForZoomAtCursor(
      cursorClip,
      this.userPan,
      this.userZoom,
      newZoom,
    );
    this.userZoom = newZoom;
    this.draw();
  }

  resetView(): void {
    this.resetViewState();
    this.draw();
  }

  getImagePixelAtCanvasPoint(xPx: number, yPx: number): ImagePixelPoint | null {
    if (!this.currentSource) return null;
    return convertCanvasPixelToImagePixelOrNull({
      canvasPointPx: { x: xPx, y: yPx },
      displaySize: this.displaySize,
      imageSize: this.imageSize,
      fitScale: computeFitToViewportScale(this.imageSize, this.displaySize),
      userZoom: this.userZoom,
      userPan: this.userPan,
    });
  }

  dispose(): void {
    this.detachContextLifecycleListeners();
    this.releaseAllWebGlResources();
  }

  private resetViewState(): void {
    this.userZoom = INITIAL_USER_ZOOM;
    this.userPan = IDENTITY_PAN;
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
    reportHalfFloatExtensionMissingOnce(gl, this.options.onError);
    this.programResources = createViewportRendererProgram(gl);
    this.applyViewportToCanvasSize();
    this.uploadCurrentSourceIfReady();
    this.draw();
  }

  private respondToContextLost(event: Event): void {
    event.preventDefault();
    this.programResources = null;
    this.singleTexture = null;
    this.rasterTileTextures = [];
    this.gl = null;
    console.warn("[viewport] WebGL context lost");
  }

  private respondToContextRestored(): void {
    console.info("[viewport] WebGL context restored; reinitializing.");
    this.initializeWebGl();
  }

  private uploadCurrentSourceIfReady(): void {
    if (!this.gl || !this.currentSource) return;
    this.releaseCurrentSourceTextures();
    if (this.currentSource.kind === "raster") {
      this.rasterTileTextures = createRasterTileTexturesForRasterBand(
        this.gl,
        this.currentSource.raster,
        this.selectedRasterBandIndex,
      );
      return;
    }
    this.singleTexture = createTextureFromBrowserSource(this.gl, this.currentSource);
  }

  private rebuildRasterTilesForSelectedBand(): void {
    if (!this.gl || !this.currentSource || this.currentSource.kind !== "raster") return;
    deleteRasterTileTexturesSafely(this.gl, this.rasterTileTextures);
    this.rasterTileTextures = createRasterTileTexturesForRasterBand(
      this.gl,
      this.currentSource.raster,
      this.selectedRasterBandIndex,
    );
  }

  private releaseCurrentSourceTextures(): void {
    if (!this.gl) return;
    deleteTextureSafely(this.gl, this.singleTexture);
    this.singleTexture = null;
    deleteRasterTileTexturesSafely(this.gl, this.rasterTileTextures);
    this.rasterTileTextures = [];
  }

  private applyViewportToCanvasSize(): void {
    if (!this.gl) return;
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  private draw(): void {
    const { gl, programResources } = this;
    if (!gl || !programResources) return;
    clearCanvasToTransparentBlack(gl);
    const transform = this.computeCurrentQuadTransform();
    const renderState = this.snapshotCurrentRenderState();
    if (this.singleTexture) {
      drawSingleTextureWithTransform(gl, programResources, this.singleTexture, transform, renderState);
      return;
    }
    if (this.rasterTileTextures.length > 0) {
      this.drawRasterTilesWithPerTileTransforms(gl, programResources, transform, renderState);
    }
  }

  private snapshotCurrentRenderState(): RenderPassState {
    return { normalization: this.normalization, isSingleBand: this.isSingleBandSource };
  }

  private drawRasterTilesWithPerTileTransforms(
    gl: WebGL2RenderingContext,
    programResources: RendererProgramResources,
    globalTransform: QuadTransform,
    renderState: RenderPassState,
  ): void {
    for (const tile of this.rasterTileTextures) {
      const tileTransform = composeTileQuadTransform(globalTransform, tile, this.imageSize);
      drawSingleTextureWithTransform(
        gl,
        programResources,
        tile.texture,
        tileTransform,
        renderState,
      );
    }
  }

  private computeCurrentQuadTransform(): QuadTransform {
    const fitScale = computeFitToViewportScale(this.imageSize, this.displaySize);
    return {
      scale: { x: fitScale.x * this.userZoom, y: fitScale.y * this.userZoom },
      translate: this.userPan,
    };
  }

  private releaseAllWebGlResources(): void {
    if (!this.gl) return;
    this.releaseCurrentSourceTextures();
    deleteRendererProgramResources(this.gl, this.programResources);
    this.programResources = null;
    this.gl = null;
  }
}

let halfFloatExtensionWarningShown = false;

function reportHalfFloatExtensionMissingOnce(
  gl: WebGL2RenderingContext,
  onError: ((message: string) => void) | undefined,
): void {
  if (probeHalfFloatColorBufferExtension(gl)) return;
  if (halfFloatExtensionWarningShown) return;
  halfFloatExtensionWarningShown = true;
  if (onError) onError(HALF_FLOAT_UNSUPPORTED_MESSAGE);
  else console.warn(`[viewport] ${HALF_FLOAT_UNSUPPORTED_MESSAGE}`);
}

function clampBandIndexForSource(source: ViewportImageSource, bandIndex: number): number {
  if (source.kind !== "raster") return 0;
  return clampBandIndexToRaster(source.raster, bandIndex);
}

function isSingleBandSourceWithSelectedBand(source: ViewportImageSource): boolean {
  return source.kind === "raster";
}

function createRasterTileTexturesForRasterBand(
  gl: WebGL2RenderingContext,
  raster: RasterImage,
  bandIndex: number,
): RasterTileTexture[] {
  const pixels = getRasterBandPixelsOrThrow(raster, bandIndex);
  const rasterTiles = splitRasterBandIntoTiles(
    { pixels, width: raster.width, height: raster.height },
    DEFAULT_RASTER_TILE_SIZE,
  );
  return rasterTiles.map((tile) => createR16FTextureForRasterTile(gl, tile, raster));
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

function drawSingleTextureWithTransform(
  gl: WebGL2RenderingContext,
  resources: RendererProgramResources,
  texture: WebGLTexture,
  transform: QuadTransform,
  renderState: RenderPassState,
): void {
  gl.useProgram(resources.program);
  applyQuadTransformUniforms(gl, resources.uniforms.quadTransform, transform);
  applyNormalizationUniforms(gl, resources.uniforms.normalization, renderState.normalization);
  applyBandModeUniforms(gl, resources.uniforms.bandMode, renderState.isSingleBand);
  gl.bindVertexArray(resources.vao);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindVertexArray(null);
}

function applyBandModeUniforms(
  gl: WebGL2RenderingContext,
  uniforms: BandModeUniformLocations,
  isSingleBand: boolean,
): void {
  if (uniforms.isSingleBand === null) return;
  gl.uniform1i(uniforms.isSingleBand, isSingleBand ? 1 : 0);
}

function applyQuadTransformUniforms(
  gl: WebGL2RenderingContext,
  uniforms: QuadTransformUniformLocations,
  transform: QuadTransform,
): void {
  if (uniforms.quadScale !== null) {
    gl.uniform2f(uniforms.quadScale, transform.scale.x, transform.scale.y);
  }
  if (uniforms.quadTranslate !== null) {
    gl.uniform2f(
      uniforms.quadTranslate,
      transform.translate.x,
      transform.translate.y,
    );
  }
}

function applyNormalizationUniforms(
  gl: WebGL2RenderingContext,
  uniforms: NormalizationUniformLocations,
  normalization: NormalizationState,
): void {
  if (uniforms.enabled !== null) {
    gl.uniform1i(uniforms.enabled, normalization.enabled ? 1 : 0);
  }
  applyVec3UniformFromTriple(gl, uniforms.minColor, normalization.extents.min);
  applyVec3UniformFromTriple(gl, uniforms.maxColor, normalization.extents.max);
}

function applyVec3UniformFromTriple(
  gl: WebGL2RenderingContext,
  location: WebGLUniformLocation | null,
  triple: readonly [number, number, number],
): void {
  if (location === null) return;
  gl.uniform3f(location, triple[0], triple[1], triple[2]);
}

function createViewportRendererProgram(
  gl: WebGL2RenderingContext,
): RendererProgramResources {
  const program = compileAndLinkViewportProgram(gl);
  const vertexBuffer = createFullscreenQuadVertexBuffer(gl);
  const vao = createFullscreenQuadVertexArray(gl, vertexBuffer);
  bindTextureSamplerToUnitZero(gl, program);
  const uniforms = lookUpProgramUniformLocations(gl, program);
  return { program, vao, vertexBuffer, uniforms };
}

function lookUpProgramUniformLocations(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
): ProgramUniformLocations {
  return {
    quadTransform: lookUpQuadTransformUniformLocations(gl, program),
    normalization: lookUpNormalizationUniformLocations(gl, program),
    bandMode: lookUpBandModeUniformLocations(gl, program),
  };
}

function lookUpBandModeUniformLocations(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
): BandModeUniformLocations {
  return {
    isSingleBand: gl.getUniformLocation(program, "u_isSingleBand"),
  };
}

function lookUpQuadTransformUniformLocations(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
): QuadTransformUniformLocations {
  return {
    quadScale: gl.getUniformLocation(program, "u_quadScale"),
    quadTranslate: gl.getUniformLocation(program, "u_quadTranslate"),
  };
}

function lookUpNormalizationUniformLocations(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
): NormalizationUniformLocations {
  return {
    enabled: gl.getUniformLocation(program, "u_normalizeEnabled"),
    minColor: gl.getUniformLocation(program, "u_normalizeMinColor"),
    maxColor: gl.getUniformLocation(program, "u_normalizeMaxColor"),
  };
}

function compileAndLinkViewportProgram(
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
    VIEWPORT_FRAGMENT_SHADER_SOURCE,
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
    2 * Float32Array.BYTES_PER_ELEMENT,
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
