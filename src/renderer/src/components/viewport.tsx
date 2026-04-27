import { useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject, RefObject } from "react";

import { Switch } from "@/components/ui/switch";
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
  const [normalizationEnabled, setNormalizationEnabled] = useState(false);
  const fallbackTestImageSource = useFallbackTestImageSource();
  const effectiveSource = props.imageSource ?? fallbackTestImageSource;
  const viewportAriaLabel = describeViewportAriaLabel(props.viewportNumber);

  useViewportRendererLifecycle(canvasRef, rendererRef);
  useImageSourceUploadEffect(rendererRef, effectiveSource);
  useNormalizationToggleEffect(rendererRef, normalizationEnabled);
  useCanvasResizeObserverEffect(canvasRef, rendererRef);
  useViewportPanZoomInteractions(canvasRef, rendererRef);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-md border bg-card">
      <ViewportHeaderStrip
        viewportNumber={props.viewportNumber ?? null}
        fileName={props.fileName ?? null}
        normalizationEnabled={normalizationEnabled}
        onNormalizationEnabledChange={setNormalizationEnabled}
      />
      <div className="relative min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          className="block h-full w-full touch-none select-none"
          aria-label={viewportAriaLabel}
        />
      </div>
    </div>
  );
}

function describeViewportAriaLabel(viewportNumber: number | null | undefined): string {
  if (typeof viewportNumber === "number") return `Viewport ${viewportNumber}`;
  return "Image viewport";
}

interface ViewportHeaderStripProps {
  viewportNumber: number | null;
  fileName: string | null;
  normalizationEnabled: boolean;
  onNormalizationEnabledChange: (enabled: boolean) => void;
}

function ViewportHeaderStrip(props: ViewportHeaderStripProps): JSX.Element {
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b bg-card px-2 text-xs">
      {typeof props.viewportNumber === "number" ? (
        <ViewportNumberBadge viewportNumber={props.viewportNumber} />
      ) : null}
      {props.fileName ? <ViewportFileNameLabel fileName={props.fileName} /> : null}
      <ViewportNormalizationToggle
        enabled={props.normalizationEnabled}
        onChange={props.onNormalizationEnabledChange}
      />
    </div>
  );
}

function ViewportFileNameLabel({ fileName }: { fileName: string }): JSX.Element {
  return (
    <span
      className="truncate font-medium text-foreground"
      title={fileName}
    >
      {fileName}
    </span>
  );
}

function ViewportNumberBadge({
  viewportNumber,
}: {
  viewportNumber: number;
}): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded border bg-background px-1 text-xs font-medium text-muted-foreground"
    >
      {viewportNumber}
    </span>
  );
}

interface ViewportNormalizationToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

function ViewportNormalizationToggle(
  props: ViewportNormalizationToggleProps,
): JSX.Element {
  return (
    <label className="ml-auto flex shrink-0 cursor-pointer items-center gap-1.5">
      <span className="select-none text-muted-foreground">Normalize</span>
      <Switch
        checked={props.enabled}
        onCheckedChange={props.onChange}
        aria-label="Toggle linear normalization"
      />
    </label>
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

function useNormalizationToggleEffect(
  rendererRef: MutableRefObject<ViewportRenderer | null>,
  enabled: boolean,
): void {
  useEffect(() => {
    rendererRef.current?.setNormalizationEnabled(enabled);
  }, [rendererRef, enabled]);
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
