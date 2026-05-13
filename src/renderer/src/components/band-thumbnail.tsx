import { useEffect, useRef, useState } from "react";

import {
  BandThumbnailCache,
  computeOrReadBandThumbnailViaCache,
  type BandThumbnailCacheEntry,
} from "@/lib/image/band-thumbnail-cache";
import type { BandThumbnailPixels } from "@/lib/image/build-band-thumbnail";
import type { RasterImage } from "@/lib/image/raster-image";

export const BAND_THUMBNAIL_SIZE_PX = 24;

const sharedBandThumbnailCache = new BandThumbnailCache();

interface BandThumbnailProps {
  readonly raster: RasterImage;
  readonly bandIndex: number;
}

export function BandThumbnail(props: BandThumbnailProps): JSX.Element {
  const entry = useBandThumbnailEntryAfterMicrotask(props.raster, props.bandIndex);
  if (entry?.kind === "ready") {
    return <BandThumbnailReadyCanvas pixels={entry.pixels} />;
  }
  return <BandThumbnailPlaceholder />;
}

function useBandThumbnailEntryAfterMicrotask(
  raster: RasterImage,
  bandIndex: number,
): BandThumbnailCacheEntry | null {
  const [entry, setEntry] = useState<BandThumbnailCacheEntry | null>(() =>
    sharedBandThumbnailCache.read(raster, bandIndex),
  );
  useEffect(() => {
    if (sharedBandThumbnailCache.read(raster, bandIndex)) return;
    let canceled = false;
    queueMicrotask(() => {
      if (canceled) return;
      const next = computeOrReadBandThumbnailViaCache(
        sharedBandThumbnailCache,
        raster,
        bandIndex,
        BAND_THUMBNAIL_SIZE_PX,
      );
      setEntry(next);
    });
    return () => {
      canceled = true;
    };
  }, [raster, bandIndex]);
  return entry;
}

function BandThumbnailPlaceholder(): JSX.Element {
  return (
    <div
      aria-hidden="true"
      style={{ width: BAND_THUMBNAIL_SIZE_PX, height: BAND_THUMBNAIL_SIZE_PX }}
      className="shrink-0 rounded-sm bg-muted"
    />
  );
}

interface BandThumbnailReadyCanvasProps {
  readonly pixels: BandThumbnailPixels;
}

function BandThumbnailReadyCanvas(props: BandThumbnailReadyCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    drawThumbnailPixelsToCanvasOrSkip(canvasRef.current, props.pixels);
  }, [props.pixels]);
  return (
    <canvas
      ref={canvasRef}
      width={props.pixels.sizePx}
      height={props.pixels.sizePx}
      aria-hidden="true"
      style={{ imageRendering: "pixelated" }}
      className="shrink-0 rounded-sm bg-muted"
    />
  );
}

function drawThumbnailPixelsToCanvasOrSkip(
  canvas: HTMLCanvasElement | null,
  pixels: BandThumbnailPixels,
): void {
  if (!canvas) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  const ownedBytes = new Uint8ClampedArray(pixels.rgba);
  const imageData = new ImageData(ownedBytes, pixels.sizePx, pixels.sizePx);
  context.putImageData(imageData, 0, 0);
}
