import { allocateFloat32ArrayOrThrow } from "@/lib/image/raster-allocation";
import type { RasterImage, RasterTypedArray } from "@/lib/image/raster-image";

import type { UserScriptRunCubeInput } from "./run-user-script-chunked";

// CT-209/CT-210: describes the cube the scripting worker receives from the
// current stack. CT-219g: the cube no longer crosses IPC whole; the chunked
// orchestrator (run-user-script-chunked.ts) pulls bands one at a time through
// getBandAsFloat32, so integer sources convert to float32 lazily per band
// instead of materializing a second full-stack copy up front. This is pure so
// it is unit-testable without the IPC bridge.

export function buildUserScriptRunCubeInputFromRaster(raster: RasterImage): UserScriptRunCubeInput {
  return {
    bandCount: raster.bandCount,
    height: raster.height,
    width: raster.width,
    wavelengths: listRasterBandWavelengthsOrNull(raster),
    getBandAsFloat32: (bandIndex) => rasterBandAsFloat32(raster, bandIndex),
  };
}

// CT-307: band wavelengths reach the script when the stack carries a full
// per-band set; a partial or absent set stays null, matching the scripting
// doc's "wavelengths ... is None otherwise" contract.
function listRasterBandWavelengthsOrNull(raster: RasterImage): number[] | null {
  const wavelengths = raster.bandWavelengths;
  if (wavelengths === undefined || wavelengths.length !== raster.bandCount) return null;
  return [...wavelengths];
}

function rasterBandAsFloat32(raster: RasterImage, bandIndex: number): Float32Array {
  const band = raster.bandPixels[bandIndex];
  if (band === undefined) throw new Error("The stack has no band at the requested index.");
  return toFloat32Band(band);
}

// The per-band conversion is a band-sized allocation on a run path, so it goes
// through the mapped allocator: a pool-edge failure surfaces the in-vocabulary
// "Not enough memory" message instead of the raw allocator string (CT-241).
function toFloat32Band(band: RasterTypedArray): Float32Array {
  if (band instanceof Float32Array) return band;
  const converted = allocateFloat32ArrayOrThrow(band.length);
  converted.set(band);
  return converted;
}
