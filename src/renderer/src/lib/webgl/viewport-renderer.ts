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
  type RasterBandPixelGrid,
  type RasterTile,
} from "./raster-tile-splitter";
import {
  createR16FTextureForRasterTile,
  createRgbF16TextureForRasterTileTriple,
  deleteRasterTileTexturesSafely,
  probeHalfFloatColorBufferExtension,
  type RasterTileTexture,
} from "./raster-tile-texture";
import {
  composeTileQuadTransform,
  type QuadTransform,
} from "./tile-quad-transform";
import {
  createIdentityToneCurveLutTexture,
  uploadNormalizedValuesToToneCurveLutTexture,
} from "./tone-curve-lut-texture";
import { recordImageTextureUpload } from "@/lib/instrumentation/render-instrumentation";
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
  convertImagePixelToCanvasPointOrNull,
  type CanvasPixelPoint,
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
import { shouldRenderRasterAsRgbComposite } from "@/lib/image/raster-color-interpretation";

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

interface ToneCurveUniformLocations {
  enabled: WebGLUniformLocation | null;
}

interface ProgramUniformLocations {
  quadTransform: QuadTransformUniformLocations;
  normalization: NormalizationUniformLocations;
  bandMode: BandModeUniformLocations;
  toneCurve: ToneCurveUniformLocations;
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

interface ToneCurvePassState {
  readonly enabled: boolean;
  readonly lutTexture: WebGLTexture | null;
}

interface RenderPassState {
  readonly normalization: NormalizationState;
  readonly isSingleBand: boolean;
  readonly toneCurve: ToneCurvePassState;
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
  private autoFitsFloatDisplayWindow = false;
  private toneCurveLutTexture: WebGLTexture | null = null;
  private toneCurveLookupTable: ReadonlyArray<number> | null = null;
  private readonly viewTransformChangeListeners = new Set<() => void>();
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

  // CT-170: install a display-only tone-curve preview built in the
  // display-normalized domain. Passing null clears it; the shader branch is then
  // fully bypassed and output is byte-for-byte identical to no curve.
  setToneCurveLookupTable(lookupTable: ReadonlyArray<number> | null): void {
    this.toneCurveLookupTable = lookupTable;
    this.uploadToneCurveLookupTableToTexture();
    this.draw();
  }

  private uploadToneCurveLookupTableToTexture(): void {
    if (!this.gl || !this.toneCurveLutTexture || !this.toneCurveLookupTable) return;
    uploadNormalizedValuesToToneCurveLutTexture(this.gl, this.toneCurveLutTexture, this.toneCurveLookupTable);
  }

  private cacheNormalizationExtentsForSource(source: ViewportImageSource): void {
    const extents = computeImageRgbChannelExtents(source, this.selectedRasterBandIndex);
    this.normalization = { enabled: this.normalization.enabled, extents };
    this.autoFitsFloatDisplayWindow = floatSourceDataFallsOutsideUnitDisplayWindow(source, extents);
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
    const newZoom = clampUserZoom(this.userZoom * factor, this.imageSize, this.displaySize);
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

  getCanvasPointForImagePixel(imageX: number, imageY: number): CanvasPixelPoint | null {
    if (!this.currentSource) return null;
    return convertImagePixelToCanvasPointOrNull({
      imagePixelPoint: { x: imageX, y: imageY },
      displaySize: this.displaySize,
      imageSize: this.imageSize,
      fitScale: computeFitToViewportScale(this.imageSize, this.displaySize),
      userZoom: this.userZoom,
      userPan: this.userPan,
    });
  }

  subscribeToViewTransformChanges(listener: () => void): () => void {
    this.viewTransformChangeListeners.add(listener);
    return () => {
      this.viewTransformChangeListeners.delete(listener);
    };
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
    this.createAndRestoreToneCurveLutTexture(gl);
    this.applyViewportToCanvasSize();
    this.uploadCurrentSourceIfReady();
    this.draw();
  }

  private createAndRestoreToneCurveLutTexture(gl: WebGL2RenderingContext): void {
    this.toneCurveLutTexture = createIdentityToneCurveLutTexture(gl);
    this.uploadToneCurveLookupTableToTexture();
  }

  private respondToContextLost(event: Event): void {
    event.preventDefault();
    this.programResources = null;
    this.singleTexture = null;
    this.rasterTileTextures = [];
    this.toneCurveLutTexture = null;
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
    recordImageTextureUpload();
    if (this.currentSource.kind === "raster") {
      this.rasterTileTextures = createRasterTileTexturesForSource(
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
    recordImageTextureUpload();
    this.rasterTileTextures = createRasterTileTexturesForSource(
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
      this.notifyViewTransformChangeListeners();
      return;
    }
    if (this.rasterTileTextures.length > 0) {
      this.drawRasterTilesWithPerTileTransforms(gl, programResources, transform, renderState);
    }
    this.notifyViewTransformChangeListeners();
  }

  private notifyViewTransformChangeListeners(): void {
    for (const listener of this.viewTransformChangeListeners) listener();
  }

  private snapshotCurrentRenderState(): RenderPassState {
    return {
      normalization: this.resolveEffectiveNormalization(),
      isSingleBand: this.isSingleBandSource,
      toneCurve: this.snapshotToneCurvePassState(),
    };
  }

  private snapshotToneCurvePassState(): ToneCurvePassState {
    return {
      enabled: this.toneCurveLookupTable !== null && this.toneCurveLutTexture !== null,
      lutTexture: this.toneCurveLutTexture,
    };
  }

  // A float raster whose data lies outside [0, 1] would saturate to a flat white
  // frame under the fixed [0, 1] default window, so auto-fit its display window to
  // the data's own extents on open. This is display-only: the user toggle, pixel
  // data, and History are untouched (CT-161).
  private resolveEffectiveNormalization(): NormalizationState {
    if (this.normalization.enabled || !this.autoFitsFloatDisplayWindow) return this.normalization;
    return { enabled: true, extents: this.normalization.extents };
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
    deleteTextureSafely(this.gl, this.toneCurveLutTexture);
    this.toneCurveLutTexture = null;
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
  if (source.kind !== "raster") return false;
  return !shouldRenderRasterAsRgbComposite(source.raster);
}

function floatSourceDataFallsOutsideUnitDisplayWindow(
  source: ViewportImageSource,
  extents: RgbChannelExtents,
): boolean {
  if (source.kind !== "raster" || source.raster.sampleFormat !== "float") return false;
  return anyChannelExtentExceedsUnitWindow(extents);
}

function anyChannelExtentExceedsUnitWindow(extents: RgbChannelExtents): boolean {
  const exceedsBelow = extents.min.some((minValue) => minValue < 0);
  const exceedsAbove = extents.max.some((maxValue) => maxValue > 1);
  return exceedsBelow || exceedsAbove;
}

function createRasterTileTexturesForSource(
  gl: WebGL2RenderingContext,
  raster: RasterImage,
  bandIndex: number,
): RasterTileTexture[] {
  if (shouldRenderRasterAsRgbComposite(raster)) {
    return createRgbCompositeTileTextures(gl, raster);
  }
  return createRasterTileTexturesForRasterBand(gl, raster, bandIndex);
}

function createRasterTileTexturesForRasterBand(
  gl: WebGL2RenderingContext,
  raster: RasterImage,
  bandIndex: number,
): RasterTileTexture[] {
  const rasterTiles = splitRasterBandIntoTiles(bandPixelGridForRaster(raster, bandIndex), DEFAULT_RASTER_TILE_SIZE);
  return rasterTiles.map((tile) => createR16FTextureForRasterTile(gl, tile, raster));
}

function createRgbCompositeTileTextures(
  gl: WebGL2RenderingContext,
  raster: RasterImage,
): RasterTileTexture[] {
  const [redTiles, greenTiles, blueTiles] = splitRgbCompositeBandsIntoAlignedTiles(raster);
  return redTiles.map((redTile, tileIndex) =>
    createRgbF16TextureForRasterTileTriple(gl, [redTile, greenTiles[tileIndex]!, blueTiles[tileIndex]!], raster),
  );
}

function splitRgbCompositeBandsIntoAlignedTiles(
  raster: RasterImage,
): readonly [readonly RasterTile[], readonly RasterTile[], readonly RasterTile[]] {
  return [
    splitRasterBandIntoTiles(bandPixelGridForRaster(raster, 0), DEFAULT_RASTER_TILE_SIZE),
    splitRasterBandIntoTiles(bandPixelGridForRaster(raster, 1), DEFAULT_RASTER_TILE_SIZE),
    splitRasterBandIntoTiles(bandPixelGridForRaster(raster, 2), DEFAULT_RASTER_TILE_SIZE),
  ];
}

function bandPixelGridForRaster(raster: RasterImage, bandIndex: number): RasterBandPixelGrid {
  return { pixels: getRasterBandPixelsOrThrow(raster, bandIndex), width: raster.width, height: raster.height };
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
  applyToneCurveUniforms(gl, resources.uniforms.toneCurve, renderState.toneCurve);
  gl.bindVertexArray(resources.vao);
  bindToneCurveLutToUnitOne(gl, renderState.toneCurve.lutTexture);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindVertexArray(null);
}

function applyToneCurveUniforms(
  gl: WebGL2RenderingContext,
  uniforms: ToneCurveUniformLocations,
  toneCurve: ToneCurvePassState,
): void {
  if (uniforms.enabled === null) return;
  const enabled = toneCurve.enabled && toneCurve.lutTexture !== null;
  gl.uniform1i(uniforms.enabled, enabled ? 1 : 0);
}

function bindToneCurveLutToUnitOne(
  gl: WebGL2RenderingContext,
  lutTexture: WebGLTexture | null,
): void {
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, lutTexture);
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
  bindToneCurveLutSamplerToUnitOne(gl, program);
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
    toneCurve: lookUpToneCurveUniformLocations(gl, program),
  };
}

function lookUpToneCurveUniformLocations(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
): ToneCurveUniformLocations {
  return {
    enabled: gl.getUniformLocation(program, "u_toneCurveEnabled"),
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

function bindToneCurveLutSamplerToUnitOne(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
): void {
  const samplerLocation = gl.getUniformLocation(program, "u_toneCurveLut");
  if (!samplerLocation) return;
  gl.useProgram(program);
  gl.uniform1i(samplerLocation, 1);
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
