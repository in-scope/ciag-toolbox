import type { RasterImage } from "@/lib/image/raster-image";

// CT-159: the single source of truth for "show this raster as an RGB colour
// composite". Only a true-colour raster (tagged "rgb" on decode/promotion) with
// exactly three bands qualifies; everything else keeps single-band grayscale
// viewing so multi-band scientific stacks are unaffected.
export const RGB_COMPOSITE_BAND_COUNT = 3;

export function shouldRenderRasterAsRgbComposite(raster: RasterImage): boolean {
  return raster.colorInterpretation === "rgb" && raster.bandCount === RGB_COMPOSITE_BAND_COUNT;
}
