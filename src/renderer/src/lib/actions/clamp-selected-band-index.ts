import type { ViewportRenderingState } from "@/lib/actions/viewport-action";
import type { ViewportImageSource } from "@/lib/webgl/texture";

// CT-324: L2 Minimization, Local PCA/MNF and ROP all yield a stack with fewer
// bands than the one they read, so a result must never inherit a selected band
// index the result raster does not have; an out-of-range index breaks viewing
// and saving with "Band index N out of range". Non-raster results (a browser
// image, or an action that does not transform its source) keep their index.
export function clampSelectedBandIndexToRaster(
  state: ViewportRenderingState,
  source: ViewportImageSource | null,
): ViewportRenderingState {
  const bandCount = countBandsWhenSourceIsARaster(source);
  if (bandCount === null) return state;
  if (isSelectableBandIndexWithinBandCount(state.selectedBandIndex, bandCount)) return state;
  return { ...state, selectedBandIndex: 0 };
}

function countBandsWhenSourceIsARaster(source: ViewportImageSource | null): number | null {
  if (!source || source.kind !== "raster") return null;
  return source.raster.bandCount;
}

function isSelectableBandIndexWithinBandCount(index: number, bandCount: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < bandCount;
}
