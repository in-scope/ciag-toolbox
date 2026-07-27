import { shouldRenderRasterAsRgbComposite } from "@/lib/image/raster-color-interpretation";
import type { RasterImage } from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

// CT-248: a colour photo can be flipped into a "channel view" where its three
// display channels scroll like any scientific stack. The view is a derived
// source whose raster shares every band array with the composite by reference
// but drops the "rgb" colour tag, so every shouldRenderRasterAsRgbComposite
// consumer (renderer band selection, band navigator, header suffix, readout)
// treats it as a plain 3-band stack. It is display-only: the panel's stored
// content keeps the composite raster, so operations, exports, and project
// saves never see the derived view. The derived source is memoized on the
// composite raster so its identity stays stable across renders and the
// viewport does not re-upload textures on every React pass.
const channelViewSourceByCompositeRaster = new WeakMap<RasterImage, ViewportImageSource>();

export function canViewCompositeChannelsSeparately(
  source: ViewportImageSource | null,
): boolean {
  if (!source || source.kind !== "raster") return false;
  return shouldRenderRasterAsRgbComposite(source.raster);
}

export function resolveImageSourceForChannelView(
  source: ViewportImageSource | null,
  viewChannelsSeparately: boolean,
): ViewportImageSource | null {
  if (!viewChannelsSeparately) return source;
  if (!source || source.kind !== "raster") return source;
  if (!shouldRenderRasterAsRgbComposite(source.raster)) return source;
  return getOrBuildSeparateChannelViewSource(source.raster);
}

function getOrBuildSeparateChannelViewSource(raster: RasterImage): ViewportImageSource {
  const cached = channelViewSourceByCompositeRaster.get(raster);
  if (cached) return cached;
  const built: ViewportImageSource = {
    kind: "raster",
    raster: { ...raster, colorInterpretation: undefined },
  };
  channelViewSourceByCompositeRaster.set(raster, built);
  return built;
}
