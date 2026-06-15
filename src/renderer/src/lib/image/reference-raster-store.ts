import type { RasterImage } from "@/lib/image/raster-image";

// CT-078: bridges asynchronous reference-cube loading to the synchronous action
// pipeline. Flat-field correction needs light/dark reference cubes loaded from
// disk, but ParameterValuesById holds only primitives and transformSource runs
// synchronously. The parameter UI loads a reference cube when picked and remembers
// it here under a token (its file path); transformSource resolves the token back
// to the raster at apply time.

const referenceRastersByToken = new Map<string, RasterImage>();

export function rememberReferenceRaster(token: string, raster: RasterImage): void {
  referenceRastersByToken.set(token, raster);
}

export function readRememberedReferenceRasterOrNull(token: string): RasterImage | null {
  return referenceRastersByToken.get(token) ?? null;
}

export function forgetAllReferenceRasters(): void {
  referenceRastersByToken.clear();
}
