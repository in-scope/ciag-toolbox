import { useEffect, useMemo, useRef } from "react";
import type { MutableRefObject, RefObject } from "react";

import { attachPanZoomEventHandlers } from "@/lib/webgl/pan-zoom-input";
import { generateBuiltInTestImage } from "@/lib/webgl/test-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";
import { ViewportRenderer } from "@/lib/webgl/viewport-renderer";

interface ViewportProps {
  imageSource?: ViewportImageSource | null;
  fileName?: string | null;
  viewportNumber?: number | null;
}

export function Viewport(props: ViewportProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<ViewportRenderer | null>(null);
  const fallbackTestImageSource = useFallbackTestImageSource();
  const effectiveSource = props.imageSource ?? fallbackTestImageSource;
  const viewportAriaLabel = describeViewportAriaLabel(props.viewportNumber);

  useViewportRendererLifecycle(canvasRef, rendererRef);
  useImageSourceUploadEffect(rendererRef, effectiveSource);
  useCanvasResizeObserverEffect(canvasRef, rendererRef);
  useViewportPanZoomInteractions(canvasRef, rendererRef);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-md border bg-card">
      <canvas
        ref={canvasRef}
        className="block h-full w-full touch-none select-none"
        aria-label={viewportAriaLabel}
      />
      {props.fileName ? <ViewportFileNameLabel fileName={props.fileName} /> : null}
      {typeof props.viewportNumber === "number" ? (
        <ViewportNumberBadge viewportNumber={props.viewportNumber} />
      ) : null}
    </div>
  );
}

function describeViewportAriaLabel(viewportNumber: number | null | undefined): string {
  if (typeof viewportNumber === "number") return `Viewport ${viewportNumber}`;
  return "Image viewport";
}

function ViewportFileNameLabel({
  fileName,
}: {
  fileName: string;
}): JSX.Element {
  return (
    <div
      className="pointer-events-none absolute left-2 top-2 max-w-[calc(100%-3rem)] truncate rounded border bg-card/80 px-2 py-1 text-xs font-medium text-foreground shadow-sm backdrop-blur-sm"
      title={fileName}
    >
      {fileName}
    </div>
  );
}

function ViewportNumberBadge({
  viewportNumber,
}: {
  viewportNumber: number;
}): JSX.Element {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute right-2 top-2 flex h-6 min-w-6 items-center justify-center rounded border bg-card/80 px-1.5 text-xs font-medium text-foreground shadow-sm backdrop-blur-sm"
    >
      {viewportNumber}
    </div>
  );
}

function useFallbackTestImageSource(): ViewportImageSource {
  return useMemo<ViewportImageSource>(() => {
    const testImage = generateBuiltInTestImage();
    return {
      kind: "pixels",
      pixels: testImage.pixels,
      width: testImage.width,
      height: testImage.height,
    };
  }, []);
}

function useViewportRendererLifecycle(
  canvasRef: RefObject<HTMLCanvasElement>,
  rendererRef: MutableRefObject<ViewportRenderer | null>,
): void {
  useEffect(() => {
    if (!canvasRef.current) return;
    rendererRef.current = new ViewportRenderer(canvasRef.current);
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
    // canvasRef and rendererRef are stable refs; effect must run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function useImageSourceUploadEffect(
  rendererRef: MutableRefObject<ViewportRenderer | null>,
  source: ViewportImageSource,
): void {
  useEffect(() => {
    rendererRef.current?.setImageSource(source);
  }, [rendererRef, source]);
}

function useCanvasResizeObserverEffect(
  canvasRef: RefObject<HTMLCanvasElement>,
  rendererRef: MutableRefObject<ViewportRenderer | null>,
): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver((entries) =>
      forwardResizeEntriesToRenderer(entries, rendererRef),
    );
    observer.observe(canvas);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function forwardResizeEntriesToRenderer(
  entries: ReadonlyArray<ResizeObserverEntry>,
  rendererRef: MutableRefObject<ViewportRenderer | null>,
): void {
  const entry = entries[0];
  if (!entry || !rendererRef.current) return;
  const { width, height } = entry.contentRect;
  rendererRef.current.resizeToDisplaySize(width, height);
}

function useViewportPanZoomInteractions(
  canvasRef: RefObject<HTMLCanvasElement>,
  rendererRef: MutableRefObject<ViewportRenderer | null>,
): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return attachPanZoomEventHandlers(canvas, () => rendererRef.current);
    // canvasRef and rendererRef are stable refs; effect must run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
