import { useEffect, useRef, type MouseEvent } from "react";
import type { MutableRefObject, RefObject } from "react";
import { FolderOpen, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { attachPanZoomEventHandlers } from "@/lib/webgl/pan-zoom-input";
import type { ViewportImageSource } from "@/lib/webgl/texture";
import { ViewportRenderer } from "@/lib/webgl/viewport-renderer";

interface ViewportProps {
  imageSource?: ViewportImageSource | null;
  fileName?: string | null;
  unresolvedFileName?: string | null;
  viewportNumber?: number | null;
  normalizationEnabled: boolean;
  selectedBandIndex: number;
  lastAppliedOperationLabel?: string | null;
  onOpenImage: () => void;
  onClose?: () => void;
}

export function Viewport(props: ViewportProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<ViewportRenderer | null>(null);
  const imageSource = props.imageSource ?? null;
  const viewportAriaLabel = describeViewportAriaLabel(props.viewportNumber);

  useViewportRendererLifecycle(canvasRef, rendererRef);
  useImageSourceUploadEffect(rendererRef, imageSource, props.selectedBandIndex);
  useSelectedBandIndexEffect(rendererRef, imageSource, props.selectedBandIndex);
  useNormalizationToggleEffect(rendererRef, props.normalizationEnabled);
  useCanvasResizeObserverEffect(canvasRef, rendererRef);
  useViewportPanZoomInteractions(canvasRef, rendererRef);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-md border bg-card">
      <ViewportHeaderStrip
        viewportNumber={props.viewportNumber ?? null}
        fileName={props.fileName ?? null}
        unresolvedFileName={props.unresolvedFileName ?? null}
        lastAppliedOperationLabel={props.lastAppliedOperationLabel ?? null}
        onClose={props.onClose ?? null}
        showCloseButton={
          (imageSource !== null || Boolean(props.unresolvedFileName)) && Boolean(props.onClose)
        }
      />
      <div className="relative min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          className="block h-full w-full touch-none select-none"
          aria-label={viewportAriaLabel}
        />
        {renderViewportEmptyOrUnresolved(imageSource, props)}
      </div>
    </div>
  );
}

function renderViewportEmptyOrUnresolved(
  imageSource: ViewportImageSource | null,
  props: ViewportProps,
): JSX.Element | null {
  if (imageSource !== null) return null;
  if (props.unresolvedFileName) {
    return <ViewportUnresolvedState fileName={props.unresolvedFileName} />;
  }
  return <ViewportEmptyState onOpenImage={props.onOpenImage} />;
}

function ViewportUnresolvedState({ fileName }: { fileName: string }): JSX.Element {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-card">
      <span className="rounded border border-destructive bg-card px-2 py-0.5 text-xs font-medium text-destructive">
        Unresolved
      </span>
      <p className="px-3 text-center text-xs text-muted-foreground">{fileName}</p>
    </div>
  );
}

function ViewportEmptyState({ onOpenImage }: { onOpenImage: () => void }): JSX.Element {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card">
      <p className="text-sm text-muted-foreground">No image loaded</p>
      <Button variant="outline" size="sm" onClick={onOpenImage}>
        <FolderOpen className="size-4" />
        Open image
      </Button>
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
  unresolvedFileName: string | null;
  lastAppliedOperationLabel: string | null;
  onClose: (() => void) | null;
  showCloseButton: boolean;
}

function ViewportHeaderStrip(props: ViewportHeaderStripProps): JSX.Element {
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b bg-card px-2 text-xs">
      {typeof props.viewportNumber === "number" ? (
        <ViewportNumberBadge viewportNumber={props.viewportNumber} />
      ) : null}
      {props.fileName ? (
        <ViewportFileNameLabel
          fileName={props.fileName}
          isUnresolved={Boolean(props.unresolvedFileName)}
          lastAppliedOperationLabel={props.lastAppliedOperationLabel}
        />
      ) : null}
      {props.showCloseButton && props.onClose ? (
        <ViewportCloseButton viewportNumber={props.viewportNumber} onClose={props.onClose} />
      ) : null}
    </div>
  );
}

interface ViewportCloseButtonProps {
  viewportNumber: number | null;
  onClose: () => void;
}

function ViewportCloseButton(props: ViewportCloseButtonProps): JSX.Element {
  const label = formatCloseButtonLabel(props.viewportNumber);
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    props.onClose();
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-6"
          aria-label={label}
          onClick={handleClick}
        >
          <X className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function formatCloseButtonLabel(viewportNumber: number | null): string {
  if (typeof viewportNumber === "number") return `Close viewport ${viewportNumber}`;
  return "Close viewport";
}

interface ViewportFileNameLabelProps {
  fileName: string;
  isUnresolved: boolean;
  lastAppliedOperationLabel: string | null;
}

function ViewportFileNameLabel(props: ViewportFileNameLabelProps): JSX.Element {
  const display = formatViewportHeaderLabel(props.fileName, props.lastAppliedOperationLabel);
  const className = props.isUnresolved
    ? "truncate font-medium italic text-muted-foreground"
    : "truncate font-medium text-foreground";
  return (
    <span className={className} title={display}>
      {display}
    </span>
  );
}

function formatViewportHeaderLabel(
  fileName: string,
  lastAppliedOperationLabel: string | null,
): string {
  if (!lastAppliedOperationLabel) return fileName;
  return `${fileName} (${lastAppliedOperationLabel})`;
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

function useViewportRendererLifecycle(
  canvasRef: RefObject<HTMLCanvasElement>,
  rendererRef: MutableRefObject<ViewportRenderer | null>,
): void {
  useEffect(() => {
    if (!canvasRef.current) return;
    rendererRef.current = new ViewportRenderer(canvasRef.current, {
      onError: showRendererErrorToast,
    });
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
    // canvasRef and rendererRef are stable refs; effect must run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function showRendererErrorToast(message: string): void {
  toast.error(message);
}

function useImageSourceUploadEffect(
  rendererRef: MutableRefObject<ViewportRenderer | null>,
  source: ViewportImageSource | null,
  selectedBandIndex: number,
): void {
  useEffect(() => {
    if (source === null) return;
    rendererRef.current?.setImageSource(source, selectedBandIndex);
    // Re-uploading on bandIndex change is handled by useSelectedBandIndexEffect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendererRef, source]);
}

function useSelectedBandIndexEffect(
  rendererRef: MutableRefObject<ViewportRenderer | null>,
  source: ViewportImageSource | null,
  selectedBandIndex: number,
): void {
  useEffect(() => {
    if (source === null || source.kind !== "raster") return;
    rendererRef.current?.setSelectedRasterBandIndex(selectedBandIndex);
  }, [rendererRef, source, selectedBandIndex]);
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
