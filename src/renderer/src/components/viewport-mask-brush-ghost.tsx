import { useMemo } from "react";
import type { CSSProperties } from "react";

import { maskBrushGhostFootprintDiameterPx, type MaskImagePoint } from "@/lib/masks/mask-brush";
import type { ViewportRenderer } from "@/lib/webgl/viewport-renderer";

// The brush ghost: a circle outlining the exact image-pixel footprint the
// brush would paint at the hovered pixel, so the user is never guessing where
// a stroke will land. Display-only chrome, mapped through the SAME view
// transform as the mask overlay, so it tracks zoom and pan.

export interface ViewportMaskBrushGhostProps {
  readonly renderer: ViewportRenderer | null;
  readonly hoveredImagePixel: MaskImagePoint | null;
  readonly brushSizePx: number;
  readonly transformVersion: number;
}

interface GhostCircleRectangle {
  readonly leftPx: number;
  readonly topPx: number;
  readonly diameterPx: number;
}

// The clipping wrapper matters: a zoomed-in ghost circle can extend far past
// the panel, and an unclipped absolute child can perturb ancestor layout
// (scrollbars), which resizes the canvas and shifts the view mapping.
export function ViewportMaskBrushGhost(props: ViewportMaskBrushGhostProps): JSX.Element | null {
  const circle = useGhostCircleRectangle(props);
  if (!circle) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        aria-hidden="true"
        data-testid="mask-brush-ghost"
        className="absolute rounded-full"
        style={buildGhostCircleStyle(circle)}
      />
    </div>
  );
}

function buildGhostCircleStyle(circle: GhostCircleRectangle): CSSProperties {
  return {
    left: `${circle.leftPx}px`,
    top: `${circle.topPx}px`,
    width: `${circle.diameterPx}px`,
    height: `${circle.diameterPx}px`,
    border: "1.5px solid var(--primary)",
    boxShadow: "0 0 0 1px var(--background)",
  };
}

function useGhostCircleRectangle(props: ViewportMaskBrushGhostProps): GhostCircleRectangle | null {
  return useMemo(
    () => computeGhostCircleRectangleOrNull(props.renderer, props.hoveredImagePixel, props.brushSizePx),
    // transformVersion intentionally tracked so the ghost follows pan and zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.renderer, props.hoveredImagePixel, props.brushSizePx, props.transformVersion],
  );
}

// The stamp centres on the hovered pixel, so its visual footprint is a circle
// around that pixel's CENTRE (x + 0.5, y + 0.5) with the parity-exact diameter
// from maskBrushGhostFootprintDiameterPx.
function computeGhostCircleRectangleOrNull(
  renderer: ViewportRenderer | null,
  hoveredImagePixel: MaskImagePoint | null,
  brushSizePx: number,
): GhostCircleRectangle | null {
  if (!renderer || !hoveredImagePixel) return null;
  const radius = maskBrushGhostFootprintDiameterPx(brushSizePx) / 2;
  const centerX = hoveredImagePixel.x + 0.5;
  const centerY = hoveredImagePixel.y + 0.5;
  const topLeft = renderer.getCanvasPointForImagePixel(centerX - radius, centerY - radius);
  const bottomRight = renderer.getCanvasPointForImagePixel(centerX + radius, centerY + radius);
  if (!topLeft || !bottomRight) return null;
  return {
    leftPx: Math.min(topLeft.x, bottomRight.x),
    topPx: Math.min(topLeft.y, bottomRight.y),
    diameterPx: Math.abs(bottomRight.x - topLeft.x),
  };
}
