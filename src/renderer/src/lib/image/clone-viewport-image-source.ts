import { cloneRasterImage, type RasterImage } from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

export async function cloneViewportImageSource(
  source: ViewportImageSource,
): Promise<ViewportImageSource> {
  if (source.kind === "pixels") return clonePixelsSource(source);
  if (source.kind === "raster") return cloneRasterSource(source);
  return cloneDomImageSource(source.image);
}

function clonePixelsSource(source: {
  pixels: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}): ViewportImageSource {
  const pixelsCopy = new Uint8ClampedArray(source.pixels);
  return { kind: "pixels", pixels: pixelsCopy, width: source.width, height: source.height };
}

function cloneRasterSource(source: {
  kind: "raster";
  raster: RasterImage;
}): ViewportImageSource {
  return { kind: "raster", raster: cloneRasterImage(source.raster) };
}

async function cloneDomImageSource(
  image: HTMLImageElement | ImageBitmap,
): Promise<ViewportImageSource> {
  const independentBitmap = await createImageBitmap(image);
  return { kind: "image-bitmap", image: independentBitmap };
}
