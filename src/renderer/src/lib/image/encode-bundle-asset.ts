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

export function encodeBakedBundleAssetForRasterSource(
  raster: RasterImage,
): BundleAssetBakedEncoding {
  if (canEncodeAsSingleChannelTiff(raster)) {
    return encodeRasterAsBakedSingleBandTiff(raster);
  }
  return encodeRasterAsBakedEnvi(raster);
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
