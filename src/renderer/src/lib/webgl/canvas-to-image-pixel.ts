import type { ClipPoint, ViewportSize } from "./view-transform";

export interface CanvasPixelPoint {
  readonly x: number;
  readonly y: number;
}

export interface ImagePixelPoint {
  readonly x: number;
  readonly y: number;
}

export interface CanvasToImagePixelInputs {
  readonly canvasPointPx: CanvasPixelPoint;
  readonly displaySize: ViewportSize;
  readonly imageSize: ViewportSize;
  readonly fitScale: ClipPoint;
  readonly userZoom: number;
  readonly userPan: ClipPoint;
}

export function convertCanvasPixelToImagePixelOrNull(
  inputs: CanvasToImagePixelInputs,
): ImagePixelPoint | null {
  if (!hasNonZeroArea(inputs.displaySize)) return null;
  if (!hasNonZeroArea(inputs.imageSize)) return null;
  const unit = projectCanvasPointBackToUntransformedQuad(inputs);
  if (!isUnitPointWithinQuadBounds(unit)) return null;
  return convertQuadUnitPointToImagePixel(unit, inputs.imageSize);
}

function projectCanvasPointBackToUntransformedQuad(
  inputs: CanvasToImagePixelInputs,
): ClipPoint {
  const clipX = (inputs.canvasPointPx.x / inputs.displaySize.width) * 2 - 1;
  const clipY = 1 - (inputs.canvasPointPx.y / inputs.displaySize.height) * 2;
  const finalScaleX = inputs.fitScale.x * inputs.userZoom;
  const finalScaleY = inputs.fitScale.y * inputs.userZoom;
  if (finalScaleX === 0 || finalScaleY === 0) return { x: 0, y: 0 };
  return {
    x: (clipX - inputs.userPan.x) / finalScaleX,
    y: (clipY - inputs.userPan.y) / finalScaleY,
  };
}

function isUnitPointWithinQuadBounds(unit: ClipPoint): boolean {
  return unit.x >= -1 && unit.x <= 1 && unit.y >= -1 && unit.y <= 1;
}

function convertQuadUnitPointToImagePixel(
  unit: ClipPoint,
  imageSize: ViewportSize,
): ImagePixelPoint {
  const textureS = (unit.x + 1) / 2;
  const textureT = (1 - unit.y) / 2;
  return {
    x: clampPixelIndexToImageBounds(Math.floor(textureS * imageSize.width), imageSize.width),
    y: clampPixelIndexToImageBounds(Math.floor(textureT * imageSize.height), imageSize.height),
  };
}

function clampPixelIndexToImageBounds(value: number, length: number): number {
  if (value < 0) return 0;
  if (value >= length) return length - 1;
  return value;
}

function hasNonZeroArea(size: ViewportSize): boolean {
  return size.width > 0 && size.height > 0;
}
