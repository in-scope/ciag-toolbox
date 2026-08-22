import { shouldRenderRasterAsRgbComposite } from "@/lib/image/raster-color-interpretation";
import type { RasterImage } from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

// CT-263: classification keys on the DECODED raster's shape, never on how the
// file was decoded. A single-band image (grayscale photo or single-band
// raster) is a stackable plane; a true-colour photo (a 3-band rgb composite)
// opens on its own; any other multi-band raster is already a stack.
export type OpenedRasterClassification =
  | { readonly kind: "stackable-plane" }
  | { readonly kind: "color-photo" }
  | { readonly kind: "already-multi-band"; readonly bandCount: number };

export function classifyOpenedRasterByShape(
  raster: RasterImage,
): OpenedRasterClassification {
  if (shouldRenderRasterAsRgbComposite(raster)) return { kind: "color-photo" };
  if (raster.bandCount === 1) return { kind: "stackable-plane" };
  return { kind: "already-multi-band", bandCount: raster.bandCount };
}

export function classifyDecodedViewportSourceForOpenImagesFlow(
  source: ViewportImageSource,
): OpenedRasterClassification {
  if (source.kind === "raster") return classifyOpenedRasterByShape(source.raster);
  // Browser decodes are promoted to rasters before grouping (CT-263); a source
  // that somehow was not is a photo, and a photo always opens on its own.
  return { kind: "color-photo" };
}
