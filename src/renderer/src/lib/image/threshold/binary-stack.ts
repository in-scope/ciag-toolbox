import type { RasterImage } from "@/lib/image/raster-image";

// CT-200: the binary output stack is a plain 2-level, 8-bit unsigned raster
// (no dedicated mask type), so it flows through tile rebuild, render, pixel
// readout, histogram, and the save paths like any other raster. Because a
// threshold changes both the band count and the sample type, the stack is
// built from an explicit shape instead of spreading the source metadata
// (mirroring makeFloat32RasterFromBands).

export const BINARY_STACK_BITS_PER_SAMPLE = 8;

export interface BinaryStackSourceMeta {
  readonly width: number;
  readonly height: number;
  readonly bandLabels?: ReadonlyArray<string>;
}

export function makeBinaryStackFromBands(
  bands: ReadonlyArray<Uint8Array>,
  sourceMeta: BinaryStackSourceMeta,
): RasterImage {
  assertBandsMatchSpatialDimensions(bands, sourceMeta);
  return {
    bandPixels: bands,
    width: sourceMeta.width,
    height: sourceMeta.height,
    bandCount: bands.length,
    sampleFormat: "uint",
    bitsPerSample: BINARY_STACK_BITS_PER_SAMPLE,
    bandLabels: sourceMeta.bandLabels ? [...sourceMeta.bandLabels] : undefined,
  };
}

function assertBandsMatchSpatialDimensions(
  bands: ReadonlyArray<Uint8Array>,
  sourceMeta: BinaryStackSourceMeta,
): void {
  if (bands.length === 0) throw new Error("A binary stack needs at least one band.");
  const expectedLength = sourceMeta.width * sourceMeta.height;
  for (const [index, band] of bands.entries()) {
    if (band.length !== expectedLength) {
      throw new Error(
        `Binary band ${index} has ${band.length} values but the stack is ` +
          `${sourceMeta.width} x ${sourceMeta.height} (${expectedLength}).`,
      );
    }
  }
}
