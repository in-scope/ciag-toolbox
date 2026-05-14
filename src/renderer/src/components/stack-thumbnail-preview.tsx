import { useEffect, useRef } from "react";

import { ImageOff } from "lucide-react";

import type { RasterImage, RasterTypedArray } from "@/lib/image/raster-image";

interface StackThumbnailPreviewProps {
  readonly raster: RasterImage | null;
  readonly sizePx: number;
}

export function StackThumbnailPreview(props: StackThumbnailPreviewProps): JSX.Element {
  if (!props.raster) return renderEmptyThumbnailPlaceholder(props.sizePx);
  return <StackRasterThumbnailCanvas raster={props.raster} sizePx={props.sizePx} />;
}

function renderEmptyThumbnailPlaceholder(sizePx: number): JSX.Element {
  return (
    <div
      aria-hidden="true"
      style={{ width: sizePx, height: sizePx }}
      className="flex shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground"
    >
      <ImageOff className="size-4" />
    </div>
  );
}

interface StackRasterThumbnailCanvasProps {
  readonly raster: RasterImage;
  readonly sizePx: number;
}

function StackRasterThumbnailCanvas(props: StackRasterThumbnailCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    drawRasterThumbnailIntoCanvasOrSkip(canvasRef.current, props.raster, props.sizePx);
  }, [props.raster, props.sizePx]);
  return (
    <canvas
      ref={canvasRef}
      width={props.sizePx}
      height={props.sizePx}
      aria-hidden="true"
      className="shrink-0 rounded-md border bg-muted object-cover"
    />
  );
}

function drawRasterThumbnailIntoCanvasOrSkip(
  canvas: HTMLCanvasElement | null,
  raster: RasterImage,
  sizePx: number,
): void {
  if (!canvas) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  const imageData = buildThumbnailImageDataFromRaster(raster, sizePx);
  context.putImageData(imageData, 0, 0);
}

function buildThumbnailImageDataFromRaster(raster: RasterImage, sizePx: number): ImageData {
  const firstBand = raster.bandPixels[0];
  if (!firstBand) return new ImageData(sizePx, sizePx);
  const sample = pickFirstBandUnitSampleFunction(raster, firstBand);
  const rgba = buildDownsampledRgbaBytes(raster, sample, sizePx);
  const owned = new Uint8ClampedArray(rgba);
  return new ImageData(owned, sizePx, sizePx);
}

type UnitSampleAtIndex = (sourceIndex: number) => number;

function pickFirstBandUnitSampleFunction(
  raster: RasterImage,
  firstBand: RasterTypedArray,
): UnitSampleAtIndex {
  const scale = computeRasterUnitScaleForThumbnail(raster);
  return (sourceIndex) => clampToUnitRange(((firstBand[sourceIndex] ?? 0) as number) * scale);
}

function computeRasterUnitScaleForThumbnail(raster: RasterImage): number {
  if (raster.sampleFormat === "float") return 1;
  const maxSampleValue = Math.pow(2, raster.bitsPerSample) - 1;
  if (maxSampleValue <= 0) return 1;
  return 1 / maxSampleValue;
}

function clampToUnitRange(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function buildDownsampledRgbaBytes(
  raster: RasterImage,
  sample: UnitSampleAtIndex,
  sizePx: number,
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(new ArrayBuffer(sizePx * sizePx * 4));
  for (let outY = 0; outY < sizePx; outY++) {
    for (let outX = 0; outX < sizePx; outX++) {
      writeDownsampledThumbnailPixel(raster, sample, outX, outY, sizePx, rgba);
    }
  }
  return rgba;
}

function writeDownsampledThumbnailPixel(
  raster: RasterImage,
  sample: UnitSampleAtIndex,
  outX: number,
  outY: number,
  sizePx: number,
  rgba: Uint8ClampedArray,
): void {
  const sourceIndex = pickNearestSourceIndexForThumbnailPixel(raster, outX, outY, sizePx);
  const unit = sample(sourceIndex);
  const byte = Math.round(unit * 255);
  const offset = (outY * sizePx + outX) * 4;
  rgba[offset] = byte;
  rgba[offset + 1] = byte;
  rgba[offset + 2] = byte;
  rgba[offset + 3] = 255;
}

function pickNearestSourceIndexForThumbnailPixel(
  raster: RasterImage,
  outX: number,
  outY: number,
  sizePx: number,
): number {
  const sourceX = Math.min(raster.width - 1, Math.floor((outX / sizePx) * raster.width));
  const sourceY = Math.min(raster.height - 1, Math.floor((outY / sizePx) * raster.height));
  return sourceY * raster.width + sourceX;
}
