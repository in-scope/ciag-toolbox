// Mirrors the renderer's fit-to-viewport transform (src/renderer/src/lib/webgl:
// view-transform.ts + canvas-to-image-pixel.ts) for the DEFAULT view only, where
// userZoom = 1 and userPan = {0, 0} (the state right after a stack loads). It maps
// an image pixel to the canvas point at that pixel's CENTER, so a Playwright hover
// lands inside the pixel's cell and the renderer's floor() inverse reports it back.

export interface PixelDimensions {
  readonly width: number;
  readonly height: number;
}

export interface CanvasPoint {
  readonly x: number;
  readonly y: number;
}

interface ClipPoint {
  readonly x: number;
  readonly y: number;
}

export function computeCanvasPointForImagePixelAtFitView(
  imagePixelX: number,
  imagePixelY: number,
  image: PixelDimensions,
  display: PixelDimensions,
): CanvasPoint {
  const fitScale = computeFitToViewportScale(image, display);
  const pixelCenter = projectPixelCenterToUnitQuad(imagePixelX, imagePixelY, image);
  return projectUnitQuadPointToCanvasPoint(pixelCenter, fitScale, display);
}

function computeFitToViewportScale(image: PixelDimensions, display: PixelDimensions): ClipPoint {
  if (!hasNonZeroArea(image) || !hasNonZeroArea(display)) return { x: 1, y: 1 };
  const imageAspect = image.width / image.height;
  const canvasAspect = display.width / display.height;
  if (imageAspect > canvasAspect) return { x: 1, y: canvasAspect / imageAspect };
  return { x: imageAspect / canvasAspect, y: 1 };
}

function projectPixelCenterToUnitQuad(
  imagePixelX: number,
  imagePixelY: number,
  image: PixelDimensions,
): ClipPoint {
  const textureS = (imagePixelX + 0.5) / image.width;
  const textureT = (imagePixelY + 0.5) / image.height;
  return { x: textureS * 2 - 1, y: 1 - textureT * 2 };
}

function projectUnitQuadPointToCanvasPoint(
  unit: ClipPoint,
  fitScale: ClipPoint,
  display: PixelDimensions,
): CanvasPoint {
  const clipX = fitScale.x * unit.x;
  const clipY = fitScale.y * unit.y;
  return {
    x: ((clipX + 1) / 2) * display.width,
    y: ((1 - clipY) / 2) * display.height,
  };
}

function hasNonZeroArea(size: PixelDimensions): boolean {
  return size.width > 0 && size.height > 0;
}
