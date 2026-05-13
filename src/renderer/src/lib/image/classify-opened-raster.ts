import type { RasterImage } from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

export type OpenedRasterClassification =
  | { readonly kind: "stackable-plane" }
  | { readonly kind: "already-multi-band"; readonly bandCount: number };

export function classifyOpenedRasterByShape(
  raster: RasterImage,
): OpenedRasterClassification {
  if (raster.bandCount === 1) return { kind: "stackable-plane" };
  return { kind: "already-multi-band", bandCount: raster.bandCount };
}

export function classifyDecodedViewportSourceForOpenImagesFlow(
  source: ViewportImageSource,
): OpenedRasterClassification {
  if (source.kind === "raster") return classifyOpenedRasterByShape(source.raster);
  return { kind: "already-multi-band", bandCount: 1 };
}
