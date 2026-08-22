import { useCallback, useEffect, useMemo, useRef } from "react";
import type { CSSProperties } from "react";

import type { MaskLayer } from "@/lib/masks/mask-layer";
import { buildMaskOverlayRgbaBytes } from "@/lib/masks/mask-overlay-image";
import type { CanvasRectangle } from "@/components/viewport-roi-overlay";
import type { ViewportRenderer } from "@/lib/webgl/viewport-renderer";

// CT-304: the selected mask layer, drawn OVER the image as a translucent tint.
//
// The overlay is its own small 2D canvas whose backing store is the MASK's grid
// (one canvas pixel per image pixel), stretched by CSS to the rectangle the
// image currently occupies and left unsmoothed, so a stroke lands exactly on
// the image pixels it painted at any zoom or pan. Nothing here touches the
// WebGL pipeline or the raster: the pixel readout keeps reporting the data
// values underneath, unchanged.

export interface ViewportMaskOverlayProps {
  readonly renderer: ViewportRenderer | null;
  readonly layer: MaskLayer | null;
  readonly values: Uint8Array | null;
  readonly transformVersion: number;
  readonly paintVersion: number;
}

export function ViewportMaskOverlay(props: ViewportMaskOverlayProps): JSX.Element | null {
  const rectangle = useMaskOverlayCanvasRectangle(props);
  const attachOverlayCanvas = usePaintedMaskOverlayCanvasRef(props);
  if (!props.layer || !rectangle) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <canvas
        ref={attachOverlayCanvas}
        aria-hidden="true"
        data-testid="viewport-mask-overlay"
        width={props.layer.width}
        height={props.layer.height}
        style={buildMaskOverlayCanvasStyle(rectangle)}
      />
    </div>
  );
}

function buildMaskOverlayCanvasStyle(rectangle: CanvasRectangle): CSSProperties {
  return {
    position: "absolute",
    left: `${rectangle.leftPx}px`,
    top: `${rectangle.topPx}px`,
    width: `${rectangle.widthPx}px`,
    height: `${rectangle.heightPx}px`,
    imageRendering: "pixelated",
  };
}

// The image's canvas rectangle re-derives whenever the view transform changes,
// exactly like the committed-region overlay does.
function useMaskOverlayCanvasRectangle(props: ViewportMaskOverlayProps): CanvasRectangle | null {
  return useMemo(
    () => computeCanvasRectangleForWholeImageOrNull(props.renderer, props.layer),
    // transformVersion intentionally tracked so the overlay follows pan and zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.renderer, props.layer, props.transformVersion],
  );
}

function computeCanvasRectangleForWholeImageOrNull(
  renderer: ViewportRenderer | null,
  layer: MaskLayer | null,
): CanvasRectangle | null {
  if (!renderer || !layer) return null;
  const topLeft = renderer.getCanvasPointForImagePixel(0, 0);
  const bottomRight = renderer.getCanvasPointForImagePixel(layer.width, layer.height);
  if (!topLeft || !bottomRight) return null;
  return {
    leftPx: Math.min(topLeft.x, bottomRight.x),
    topPx: Math.min(topLeft.y, bottomRight.y),
    widthPx: Math.abs(bottomRight.x - topLeft.x),
    heightPx: Math.abs(bottomRight.y - topLeft.y),
  };
}

type MaskOverlayCanvasRef = (canvas: HTMLCanvasElement | null) => void;

// A callback ref rather than a plain one: the overlay canvas mounts only once
// the renderer can place it, which is often AFTER the values it must draw were
// last set, and a paint effect alone would then leave it blank.
function usePaintedMaskOverlayCanvasRef(props: ViewportMaskOverlayProps): MaskOverlayCanvasRef {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const values = props.values ?? props.layer?.values ?? null;
  const latestContentRef = useRef({ layer: props.layer, values });
  latestContentRef.current = { layer: props.layer, values };
  useEffect(() => {
    paintMaskOverlayCanvas(canvasRef.current, props.layer, values);
    // paintVersion tracks an in-progress stroke, which mutates values in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.layer, values, props.paintVersion]);
  return useCallback((canvas: HTMLCanvasElement | null) => {
    canvasRef.current = canvas;
    paintMaskOverlayCanvas(canvas, latestContentRef.current.layer, latestContentRef.current.values);
  }, []);
}

function paintMaskOverlayCanvas(
  canvas: HTMLCanvasElement | null,
  layer: MaskLayer | null,
  values: Uint8Array | null,
): void {
  if (!canvas || !layer || !values) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.putImageData(buildMaskOverlayImageData(layer, values), 0, 0);
}

function buildMaskOverlayImageData(layer: MaskLayer, values: Uint8Array): ImageData {
  const bytes = buildMaskOverlayRgbaBytes({
    values,
    categories: layer.categories,
    opacityPercent: layer.opacityPercent,
  });
  return new ImageData(bytes, layer.width, layer.height);
}
