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

interface CanvasRectangle {
  readonly leftPx: number;
  readonly topPx: number;
  readonly widthPx: number;
  readonly heightPx: number;
}

export function ViewportRoiOverlay(props: ViewportRoiOverlayProps): JSX.Element | null {
  const rectangle = useCanvasRectangleForOverlayContent(props);
  if (!rectangle) return null;
  return <RoiOverlaySvgRectangle rectangle={rectangle} />;
}

function useCanvasRectangleForOverlayContent(
  props: ViewportRoiOverlayProps,
): CanvasRectangle | null {
  return useMemo(
    () => pickCanvasRectangleFromRoiOverlayProps(props),
    // transformVersion intentionally tracked so committed ROI re-derives on pan/zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.committedRoi, props.inProgressDragRect, props.renderer, props.transformVersion],
  );
}

function pickCanvasRectangleFromRoiOverlayProps(
  props: ViewportRoiOverlayProps,
): CanvasRectangle | null {
  if (props.inProgressDragRect) {
    return buildCanvasRectangleFromCanvasCorners(
      props.inProgressDragRect.start,
      props.inProgressDragRect.current,
    );
  }
  if (props.committedRoi && props.renderer) {
    return buildCanvasRectangleFromCommittedRoi(props.committedRoi, props.renderer);
  }
  return null;
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
}

function RoiOverlaySvgRectangle(props: RoiOverlaySvgRectangleProps): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      <RoiOverlayDashedBorder rectangle={props.rectangle} />
      <RoiOverlayCornerHandles rectangle={props.rectangle} />
    </svg>
  );
}

function RoiOverlayDashedBorder(props: RoiOverlaySvgRectangleProps): JSX.Element {
  const { leftPx, topPx, widthPx, heightPx } = props.rectangle;
  return (
    <rect
      x={leftPx}
      y={topPx}
      width={widthPx}
      height={heightPx}
      fill="none"
      stroke="hsl(var(--primary))"
      strokeWidth={ROI_RECT_STROKE_WIDTH_PX}
      strokeDasharray={ROI_DASH_PATTERN}
    />
  );
}

function RoiOverlayCornerHandles(props: RoiOverlaySvgRectangleProps): JSX.Element {
  const corners = listFourCornerCenters(props.rectangle);
  return (
    <>
      {corners.map((corner) => (
        <RoiOverlayCornerHandleSquare key={`${corner.x}-${corner.y}`} centerX={corner.x} centerY={corner.y} />
      ))}
    </>
  );
}

interface CornerHandleCenter {
  readonly x: number;
  readonly y: number;
}

function listFourCornerCenters(rect: CanvasRectangle): ReadonlyArray<CornerHandleCenter> {
  const right = rect.leftPx + rect.widthPx;
  const bottom = rect.topPx + rect.heightPx;
  return [
    { x: rect.leftPx, y: rect.topPx },
    { x: right, y: rect.topPx },
    { x: rect.leftPx, y: bottom },
    { x: right, y: bottom },
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
      fill="hsl(var(--primary))"
      stroke="hsl(var(--background))"
      strokeWidth={1}
    />
  );
}
