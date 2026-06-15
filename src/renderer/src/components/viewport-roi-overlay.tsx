import { useMemo } from "react";

import { canonicalizeViewportRoiCorners, type ViewportRoi } from "@/lib/image/viewport-roi";
import type { CanvasPixelPoint } from "@/lib/webgl/canvas-to-image-pixel";
import type { RoiDrawCanvasRect } from "@/lib/webgl/roi-draw-input";
import type { ViewportRenderer } from "@/lib/webgl/viewport-renderer";

const ROI_RECT_STROKE_WIDTH_PX = 1.5;
const ROI_HANDLE_SIDE_PX = 8;
const ROI_DASH_PATTERN = "4 3";

interface ViewportRoiOverlayProps {
  readonly renderer: ViewportRenderer | null;
  readonly committedRoi: ViewportRoi | null;
  readonly inProgressDragRect: RoiDrawCanvasRect | null;
  readonly transformVersion: number;
}

export interface CanvasRectangle {
  readonly leftPx: number;
  readonly topPx: number;
  readonly widthPx: number;
  readonly heightPx: number;
}

interface RoiOverlayContent {
  readonly rectangle: CanvasRectangle;
  readonly showCornerHandles: boolean;
}

export function ViewportRoiOverlay(props: ViewportRoiOverlayProps): JSX.Element | null {
  const content = useRoiOverlayContent(props);
  if (!content) return null;
  return (
    <RoiOverlaySvgRectangle
      rectangle={content.rectangle}
      showCornerHandles={content.showCornerHandles}
    />
  );
}

function useRoiOverlayContent(props: ViewportRoiOverlayProps): RoiOverlayContent | null {
  return useMemo(
    () => pickRoiOverlayContentFromProps(props),
    // transformVersion intentionally tracked so committed ROI re-derives on pan/zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.committedRoi, props.inProgressDragRect, props.renderer, props.transformVersion],
  );
}

// Corner handles are drawn only for a committed ROI. While dragging we show just the
// dashed rectangle: a plain click produces a zero-size in-progress rect, and rendering
// four handles stacked on a single point left visible "stray points" on the canvas (CT-096).
function pickRoiOverlayContentFromProps(
  props: ViewportRoiOverlayProps,
): RoiOverlayContent | null {
  if (props.inProgressDragRect) {
    return buildInProgressDragOverlayContent(props.inProgressDragRect);
  }
  if (props.committedRoi && props.renderer) {
    return buildCommittedRoiOverlayContent(props.committedRoi, props.renderer);
  }
  return null;
}

function buildInProgressDragOverlayContent(
  inProgressDragRect: RoiDrawCanvasRect,
): RoiOverlayContent | null {
  const rectangle = buildCanvasRectangleFromCanvasCorners(
    inProgressDragRect.start,
    inProgressDragRect.current,
  );
  if (isCanvasRectangleDegenerate(rectangle)) return null;
  return { rectangle, showCornerHandles: false };
}

function buildCommittedRoiOverlayContent(
  committedRoi: ViewportRoi,
  renderer: ViewportRenderer,
): RoiOverlayContent | null {
  const rectangle = buildCanvasRectangleFromCommittedRoi(committedRoi, renderer);
  if (!rectangle) return null;
  return { rectangle, showCornerHandles: true };
}

export function isCanvasRectangleDegenerate(rectangle: CanvasRectangle): boolean {
  return rectangle.widthPx < 1 && rectangle.heightPx < 1;
}

function buildCanvasRectangleFromCanvasCorners(
  start: CanvasPixelPoint,
  current: CanvasPixelPoint,
): CanvasRectangle {
  return {
    leftPx: Math.min(start.x, current.x),
    topPx: Math.min(start.y, current.y),
    widthPx: Math.abs(current.x - start.x),
    heightPx: Math.abs(current.y - start.y),
  };
}

function buildCanvasRectangleFromCommittedRoi(
  roi: ViewportRoi,
  renderer: ViewportRenderer,
): CanvasRectangle | null {
  const canonical = canonicalizeViewportRoiCorners(roi);
  const topLeft = renderer.getCanvasPointForImagePixel(
    canonical.imagePixelX0,
    canonical.imagePixelY0,
  );
  const bottomRight = renderer.getCanvasPointForImagePixel(
    canonical.imagePixelX1 + 1,
    canonical.imagePixelY1 + 1,
  );
  if (!topLeft || !bottomRight) return null;
  return buildCanvasRectangleFromCanvasCorners(topLeft, bottomRight);
}

interface RoiOverlaySvgRectangleProps {
  readonly rectangle: CanvasRectangle;
  readonly showCornerHandles: boolean;
}

function RoiOverlaySvgRectangle(props: RoiOverlaySvgRectangleProps): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      <RoiOverlayDashedBorder rectangle={props.rectangle} />
      {props.showCornerHandles ? <RoiOverlayCornerHandles rectangle={props.rectangle} /> : null}
    </svg>
  );
}

function RoiOverlayDashedBorder(props: { readonly rectangle: CanvasRectangle }): JSX.Element {
  const { leftPx, topPx, widthPx, heightPx } = props.rectangle;
  return (
    <rect
      x={leftPx}
      y={topPx}
      width={widthPx}
      height={heightPx}
      fill="none"
      stroke="var(--primary)"
      strokeWidth={ROI_RECT_STROKE_WIDTH_PX}
      strokeDasharray={ROI_DASH_PATTERN}
    />
  );
}

function RoiOverlayCornerHandles(props: { readonly rectangle: CanvasRectangle }): JSX.Element {
  const corners = listFourCornerCenters(props.rectangle);
  return (
    <>
      {corners.map((corner) => (
        <RoiOverlayCornerHandleSquare key={corner.position} centerX={corner.x} centerY={corner.y} />
      ))}
    </>
  );
}

type CornerHandlePosition = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

export interface CornerHandleCenter {
  readonly position: CornerHandlePosition;
  readonly x: number;
  readonly y: number;
}

// Keyed by a stable corner position rather than coordinates: a drag passes through
// degenerate rectangles where corners share a point, and coordinate-based keys would
// collide and leave stale handle nodes stranded on the overlay (CT-060).
export function listFourCornerCenters(rect: CanvasRectangle): ReadonlyArray<CornerHandleCenter> {
  const right = rect.leftPx + rect.widthPx;
  const bottom = rect.topPx + rect.heightPx;
  return [
    { position: "topLeft", x: rect.leftPx, y: rect.topPx },
    { position: "topRight", x: right, y: rect.topPx },
    { position: "bottomLeft", x: rect.leftPx, y: bottom },
    { position: "bottomRight", x: right, y: bottom },
  ];
}

interface RoiOverlayCornerHandleSquareProps {
  readonly centerX: number;
  readonly centerY: number;
}

function RoiOverlayCornerHandleSquare(props: RoiOverlayCornerHandleSquareProps): JSX.Element {
  const half = ROI_HANDLE_SIDE_PX / 2;
  return (
    <rect
      x={props.centerX - half}
      y={props.centerY - half}
      width={ROI_HANDLE_SIDE_PX}
      height={ROI_HANDLE_SIDE_PX}
      fill="var(--primary)"
      stroke="var(--foreground)"
      strokeWidth={1.5}
    />
  );
}
