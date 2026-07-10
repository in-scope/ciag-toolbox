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

// A baked asset materializes in renderer memory as ONE Uint8Array here, and on
// project REOPEN its bytes come back in ONE project:read-bundle-asset reply,
// which is only safe up to ~2 GiB (the CT-219b serializer ceiling; the reply is
// bytes-last already). The CT-219e chunked save protocol removed the save-side
// limit, so this cap now guards the single-buffer encode and the reopen read:
// a raster that would bake bigger is rejected with a catchable error instead.
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
