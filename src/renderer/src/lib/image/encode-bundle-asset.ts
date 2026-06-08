import { encodeRasterImageAsEnviFiles } from "@/lib/image/encode-envi";
import { encodeRasterBandAsSingleChannelTiffBytes } from "@/lib/image/encode-tiff";
import type { RasterImage } from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

export interface BundleAssetBakedEncoding {
  readonly kind: "baked";
  readonly bytes: Uint8Array;
  readonly extension: string;
  readonly sidecar?: BundleAssetBakedSidecar;
}

export interface BundleAssetBakedSidecar {
  readonly extension: string;
  readonly bytes: Uint8Array;
}

// A baked asset is copied into renderer memory and then structured-cloned
// across the IPC boundary to the main process. Past roughly the V8 structured
// clone ceiling (~2 GiB) that copy crashes the renderer (white screen, CT-061),
// so a raster that must be re-encoded (because it was modified and no longer
// matches its on-disk file) is rejected with a catchable error instead.
const MAX_BAKED_BUNDLE_ASSET_BYTES = 1_800_000_000;

export function encodeBakedBundleAssetForRasterSource(
  raster: RasterImage,
): BundleAssetBakedEncoding {
  throwIfRasterTooLargeToBakeIntoBundle(raster);
  if (canEncodeAsSingleChannelTiff(raster)) {
    return encodeRasterAsBakedSingleBandTiff(raster);
  }
  return encodeRasterAsBakedEnvi(raster);
}

function throwIfRasterTooLargeToBakeIntoBundle(raster: RasterImage): void {
  if (estimateBakedRasterPayloadByteSize(raster) <= MAX_BAKED_BUNDLE_ASSET_BYTES) {
    return;
  }
  throw new Error(
    "This image is too large to bake into a saved project. Save the project before applying operations so the original file can be packed directly.",
  );
}

function estimateBakedRasterPayloadByteSize(raster: RasterImage): number {
  const bytesPerSample = raster.bandPixels[0]?.BYTES_PER_ELEMENT ?? 1;
  return raster.width * raster.height * raster.bandCount * bytesPerSample;
}

export function canBakeViewportSourceIntoBundle(
  source: ViewportImageSource,
): boolean {
  return source.kind === "raster";
}

function canEncodeAsSingleChannelTiff(raster: RasterImage): boolean {
  if (raster.bandCount !== 1) return false;
  if (raster.sampleFormat !== "uint") return false;
  return raster.bitsPerSample === 8 || raster.bitsPerSample === 16;
}

function encodeRasterAsBakedSingleBandTiff(
  raster: RasterImage,
): BundleAssetBakedEncoding {
  const targetBitDepth = raster.bitsPerSample === 8 ? 8 : 16;
  const bytes = encodeRasterBandAsSingleChannelTiffBytes(raster, 0, targetBitDepth);
  return { kind: "baked", bytes, extension: "tif" };
}

function encodeRasterAsBakedEnvi(raster: RasterImage): BundleAssetBakedEncoding {
  const envi = encodeRasterImageAsEnviFiles(raster);
  return {
    kind: "baked",
    bytes: envi.headerBytes,
    extension: "hdr",
    sidecar: { extension: "bin", bytes: envi.binaryBytes },
  };
}
