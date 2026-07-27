import { describe, expect, it } from "vitest";

import {
  planBakedBundleAssetEncodingForRasterSource,
  type BundleAssetPartEncodingPlan,
} from "@/lib/image/encode-bundle-asset";
import { encodeRasterImageAsEnviFiles } from "@/lib/image/encode-envi";
import { encodeRasterBandAsSingleChannelTiffBytes } from "@/lib/image/encode-tiff";
import type { RasterImage, RasterSourceInterleave } from "@/lib/image/raster-image";

// CT-235: the baked plan encodes chunk by chunk; the concatenation of every
// emitted chunk must be byte-identical to the sync encoders, for chunk sizes
// that split units, rows, and the header/sample boundary.
const CHUNK_SIZES_CROSSING_BOUNDARIES = [1, 3, 7, 10, 64, 1 << 20];

describe("planBakedBundleAssetEncodingForRasterSource (ENVI bake)", () => {
  const interleaves: RasterSourceInterleave[] = ["bsq", "bil", "bip"];

  for (const interleave of interleaves) {
    it(`emits ${interleave} chunks whose concatenation matches the sync ENVI encoder`, async () => {
      const raster = buildMultiBandRasterFixture(interleave);
      const sync = encodeRasterImageAsEnviFiles(raster);
      const plan = planBakedBundleAssetEncodingForRasterSource(raster);
      expect(plan.primary.extension).toBe("hdr");
      expect(plan.sidecar?.extension).toBe("bin");
      for (const chunkSize of CHUNK_SIZES_CROSSING_BOUNDARIES) {
        expect(await collectConcatenatedChunks(plan.primary, chunkSize)).toEqual(sync.headerBytes);
        expect(await collectConcatenatedChunks(plan.sidecar!, chunkSize)).toEqual(sync.binaryBytes);
      }
    });
  }

  it("declares byte lengths matching the sync encoder without emitting", () => {
    const raster = buildMultiBandRasterFixture("bil");
    const sync = encodeRasterImageAsEnviFiles(raster);
    const plan = planBakedBundleAssetEncodingForRasterSource(raster);
    expect(plan.primary.byteLength).toBe(sync.headerBytes.byteLength);
    expect(plan.sidecar?.byteLength).toBe(sync.binaryBytes.byteLength);
  });

  it("never emits a chunk larger than the requested ceiling once above the unit size", async () => {
    const raster = buildMultiBandRasterFixture("bsq");
    const plan = planBakedBundleAssetEncodingForRasterSource(raster);
    const rowBytes = raster.width * 2;
    const sizes = await collectChunkSizes(plan.sidecar!, rowBytes * 2 + 1);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(rowBytes * 2 + 1);
    expect(sizes.length).toBeGreaterThan(1);
  });

  // The 1.8 GB bake cap is removed: planning a raster far beyond it succeeds
  // and allocates nothing proportional to the declared cube.
  it("plans a multi-gigabyte bake without a size cap and without allocating it", () => {
    const raster: RasterImage = {
      ...buildMultiBandRasterFixture("bsq"),
      width: 20_000,
      height: 20_000,
      bandCount: 10,
    };
    const plan = planBakedBundleAssetEncodingForRasterSource(raster);
    expect(plan.sidecar?.byteLength).toBe(20_000 * 20_000 * 10 * 2);
  });
});

describe("planBakedBundleAssetEncodingForRasterSource (single-band TIFF bake)", () => {
  it("emits chunks whose concatenation matches the sync single-channel TIFF encoder", async () => {
    const raster = buildSingleBandUint16RasterFixture();
    const sync = encodeRasterBandAsSingleChannelTiffBytes(raster, 0, 16);
    const plan = planBakedBundleAssetEncodingForRasterSource(raster);
    expect(plan.primary.extension).toBe("tif");
    expect(plan.sidecar).toBeUndefined();
    expect(plan.primary.byteLength).toBe(sync.byteLength);
    for (const chunkSize of CHUNK_SIZES_CROSSING_BOUNDARIES) {
      expect(await collectConcatenatedChunks(plan.primary, chunkSize)).toEqual(sync);
    }
  });

  it("matches the sync encoder for an 8-bit band as well", async () => {
    const raster = buildSingleBandUint8RasterFixture();
    const sync = encodeRasterBandAsSingleChannelTiffBytes(raster, 0, 8);
    const plan = planBakedBundleAssetEncodingForRasterSource(raster);
    expect(await collectConcatenatedChunks(plan.primary, 5)).toEqual(sync);
  });
});

async function collectConcatenatedChunks(
  plan: BundleAssetPartEncodingPlan,
  maxChunkBytes: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  await plan.emitChunksInOrder(maxChunkBytes, async (bytes) => {
    chunks.push(bytes.slice());
  });
  const merged = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  expect(merged.byteLength).toBe(plan.byteLength);
  return merged;
}

async function collectChunkSizes(
  plan: BundleAssetPartEncodingPlan,
  maxChunkBytes: number,
): Promise<number[]> {
  const sizes: number[] = [];
  await plan.emitChunksInOrder(maxChunkBytes, async (bytes) => {
    sizes.push(bytes.byteLength);
  });
  return sizes;
}

function buildMultiBandRasterFixture(interleave: RasterSourceInterleave): RasterImage {
  const width = 5;
  const height = 4;
  const bands = [0, 1, 2].map(
    (bandIndex) =>
      new Uint16Array(Array.from({ length: width * height }, (_, i) => bandIndex * 1000 + i * 7)),
  );
  return {
    bandPixels: bands,
    width,
    height,
    bandCount: 3,
    bitsPerSample: 16,
    sampleFormat: "uint",
    sourceInterleave: interleave,
  };
}

function buildSingleBandUint16RasterFixture(): RasterImage {
  const width = 6;
  const height = 5;
  return {
    bandPixels: [new Uint16Array(Array.from({ length: width * height }, (_, i) => i * 321))],
    width,
    height,
    bandCount: 1,
    bitsPerSample: 16,
    sampleFormat: "uint",
  };
}

function buildSingleBandUint8RasterFixture(): RasterImage {
  const width = 4;
  const height = 3;
  return {
    bandPixels: [new Uint8Array(Array.from({ length: width * height }, (_, i) => (i * 19) % 256))],
    width,
    height,
    bandCount: 1,
    bitsPerSample: 8,
    sampleFormat: "uint",
  };
}
