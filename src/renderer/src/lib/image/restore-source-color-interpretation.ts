import type { RasterColorInterpretation } from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

// CT-174: a baked true-colour photo reopens as a plain 3-band ENVI/TIFF raster
// with no colour tag, so it would render grayscale. Re-apply the colour flag the
// project manifest preserved so the viewport shows an RGB composite again. A
// browser source (an unmodified photo streamed by reference) already renders in
// colour natively, so it is returned untouched.
export function restoreSourceColorInterpretation(
  source: ViewportImageSource,
  colorInterpretation: RasterColorInterpretation | undefined,
): ViewportImageSource {
  if (!colorInterpretation) return source;
  if (source.kind !== "raster") return source;
  return { kind: "raster", raster: { ...source.raster, colorInterpretation } };
}
