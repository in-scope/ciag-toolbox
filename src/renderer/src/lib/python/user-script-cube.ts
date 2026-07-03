import type { RasterImage, RasterTypedArray } from "@/lib/image/raster-image";

// CT-209/CT-210: builds the cube the scripting worker receives from the current
// stack. Every band is converted to a Float32Array so the main process can send it
// as one raw little-endian float32 frame (cube-payload.ts) regardless of the
// source's integer/float sample format. This is pure so it is unit-testable
// without the IPC bridge; the renderer hands the result to window.toolboxApi.runUserScript.

export interface UserScriptCube {
  bands: Float32Array[];
  height: number;
  width: number;
  wavelengths: number[] | null;
}

export function buildUserScriptCubeFromRaster(raster: RasterImage): UserScriptCube {
  return {
    bands: raster.bandPixels.map(toFloat32Band),
    height: raster.height,
    width: raster.width,
    wavelengths: null,
  };
}

function toFloat32Band(band: RasterTypedArray): Float32Array {
  if (band instanceof Float32Array) return band;
  return Float32Array.from(band);
}
