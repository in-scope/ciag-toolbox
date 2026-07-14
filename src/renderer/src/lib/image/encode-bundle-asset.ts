import {
  emitBufferInBoundedSlicesInOrder,
  type ByteChunkConsumer,
} from "@/lib/image/emit-byte-chunks";
import { planEnviFilesChunkedEncoding } from "@/lib/image/encode-envi";
import { planSingleChannelTiffChunkedEncoding } from "@/lib/image/encode-tiff";
import type { RasterImage } from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

// CT-235: a baked asset never materializes as one whole Uint8Array. Planning is
// metadata-only (byte lengths come from the raster's dimensions, so the chunked
// save protocol can describe every part before any pixel bytes exist), and the
// bytes are produced on demand in bounded chunks that the caller spools before
// the next chunk is built. The old 1.8 GB bake cap is gone: the only remaining
// limit on a baked asset is disk space at spool/write time (surfaced by the
// main-process save handlers).
export interface BundleAssetPartEncodingPlan {
  readonly extension: string;
  readonly byteLength: number;
  readonly emitChunksInOrder: (
    maxChunkBytes: number,
    onChunk: ByteChunkConsumer,
  ) => Promise<void>;
}

export interface BundleAssetChunkedEncodingPlan {
  readonly kind: "baked";
  readonly primary: BundleAssetPartEncodingPlan;
  readonly sidecar?: BundleAssetPartEncodingPlan;
}

export function planBakedBundleAssetEncodingForRasterSource(
  raster: RasterImage,
): BundleAssetChunkedEncodingPlan {
  if (canEncodeAsSingleChannelTiff(raster)) {
    return planBakedSingleBandTiffEncoding(raster);
  }
  return planBakedEnviEncoding(raster);
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

function planBakedSingleBandTiffEncoding(
  raster: RasterImage,
): BundleAssetChunkedEncodingPlan {
  const targetBitDepth = raster.bitsPerSample === 8 ? 8 : 16;
  const tiff = planSingleChannelTiffChunkedEncoding(raster, 0, targetBitDepth);
  return {
    kind: "baked",
    primary: {
      extension: "tif",
      byteLength: tiff.byteLength,
      emitChunksInOrder: tiff.emitChunksInOrder,
    },
  };
}

function planBakedEnviEncoding(raster: RasterImage): BundleAssetChunkedEncodingPlan {
  const envi = planEnviFilesChunkedEncoding(raster);
  return {
    kind: "baked",
    primary: {
      extension: "hdr",
      byteLength: envi.headerBytes.byteLength,
      emitChunksInOrder: (maxChunkBytes, onChunk) =>
        emitBufferInBoundedSlicesInOrder(envi.headerBytes, maxChunkBytes, onChunk),
    },
    sidecar: {
      extension: "bin",
      byteLength: envi.binaryByteLength,
      emitChunksInOrder: envi.emitBinaryChunksInOrder,
    },
  };
}
