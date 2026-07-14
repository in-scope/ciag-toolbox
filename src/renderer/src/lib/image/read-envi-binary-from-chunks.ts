import {
  describeSupportedEnviDataTypeOrThrow,
  type EnviDataTypeDescriptor,
} from "@/lib/image/envi-data-type";
import type { EnviHeader } from "@/lib/image/parse-envi-header";
import {
  allocateBandPixelsForHeader,
  buildInterleaveLayoutFromHeader,
  computeRequiredBinaryByteCount,
  type InterleaveLayout,
} from "@/lib/image/read-envi-binary";
import type { RasterTypedArray } from "@/lib/image/raster-image";

// CT-231: decodes an ENVI binary INCREMENTALLY from the 64 MiB chunked-read
// protocol, scattering each chunk's samples straight into per-band typed
// arrays. This replaces "assemble the whole sidecar, then decode" for the
// open path, so a 10 GB cube never exists as one buffer in any process (the
// platform caps a single allocation at 2 GiB minus 2 MiB). The output is
// byte-for-byte identical to read-envi-binary.ts over the reassembled file;
// the equivalence tests in read-envi-binary-from-chunks.test.ts pin that,
// including chunk boundaries that split a sample, a row, and a band.

export interface ChunkFedEnviBandDecoder {
  consumeChunk(chunk: Uint8Array): void;
  finishAndTakeBandPixels(): ReadonlyArray<RasterTypedArray>;
}

export function createChunkFedEnviBandDecoder(
  header: EnviHeader,
  binarySizeBytes: number,
): ChunkFedEnviBandDecoder {
  const descriptor = describeSupportedEnviDataTypeOrThrow(header.dataType);
  rejectInsufficientBinarySizeUpFront(header, descriptor, binarySizeBytes);
  const state = buildDecodeState(header, descriptor);
  return {
    consumeChunk: (chunk) => consumeOneChunkIntoBands(state, chunk),
    finishAndTakeBandPixels: () => finishTakingFilledBandPixels(state),
  };
}

function rejectInsufficientBinarySizeUpFront(
  header: EnviHeader,
  descriptor: EnviDataTypeDescriptor,
  binarySizeBytes: number,
): void {
  const required = computeRequiredBinaryByteCount(header, descriptor);
  if (binarySizeBytes < required) {
    throw new Error(
      `ENVI binary file is smaller than expected (${binarySizeBytes} bytes, need ${required})`,
    );
  }
}

interface ChunkFedDecodeState {
  readonly layout: InterleaveLayout;
  readonly descriptor: EnviDataTypeDescriptor;
  readonly bandPixels: RasterTypedArray[];
  readonly sink: EnviSampleSink;
  readonly carriedSampleBytes: Uint8Array;
  readonly carriedSampleView: DataView;
  carriedByteCount: number;
  headerBytesLeftToSkip: number;
  samplesLeftToFill: number;
}

function buildDecodeState(
  header: EnviHeader,
  descriptor: EnviDataTypeDescriptor,
): ChunkFedDecodeState {
  const layout = buildInterleaveLayoutFromHeader(header, descriptor);
  const bandPixels = allocateBandPixelsForHeader(header, descriptor);
  const carriedSampleBytes = new Uint8Array(layout.bytesPerSample);
  return {
    layout,
    descriptor,
    bandPixels,
    sink: createSampleSinkForInterleave(layout, descriptor, bandPixels),
    carriedSampleBytes,
    carriedSampleView: new DataView(carriedSampleBytes.buffer),
    carriedByteCount: 0,
    headerBytesLeftToSkip: layout.headerOffset,
    samplesLeftToFill: layout.samples * layout.lines * layout.bands,
  };
}

function consumeOneChunkIntoBands(state: ChunkFedDecodeState, chunk: Uint8Array): void {
  let offset = skipRemainingHeaderOffsetBytes(state, chunk);
  offset = completeCarriedSampleFromChunk(state, chunk, offset);
  offset = scatterWholeSamplesFromChunk(state, chunk, offset);
  stashTrailingPartialSampleIntoCarry(state, chunk, offset);
}

function skipRemainingHeaderOffsetBytes(state: ChunkFedDecodeState, chunk: Uint8Array): number {
  const skipped = Math.min(state.headerBytesLeftToSkip, chunk.byteLength);
  state.headerBytesLeftToSkip -= skipped;
  return skipped;
}

function completeCarriedSampleFromChunk(
  state: ChunkFedDecodeState,
  chunk: Uint8Array,
  offset: number,
): number {
  if (state.carriedByteCount === 0 || state.samplesLeftToFill === 0) return offset;
  const needed = state.layout.bytesPerSample - state.carriedByteCount;
  const taken = Math.min(needed, chunk.byteLength - offset);
  state.carriedSampleBytes.set(chunk.subarray(offset, offset + taken), state.carriedByteCount);
  state.carriedByteCount += taken;
  if (state.carriedByteCount === state.layout.bytesPerSample) {
    state.sink.writeNextSamples(state.carriedSampleView, 0, 1);
    state.carriedByteCount = 0;
    state.samplesLeftToFill -= 1;
  }
  return offset + taken;
}

function scatterWholeSamplesFromChunk(
  state: ChunkFedDecodeState,
  chunk: Uint8Array,
  offset: number,
): number {
  const bytesAvailable = chunk.byteLength - offset;
  const wholeSamples = Math.min(
    Math.floor(bytesAvailable / state.layout.bytesPerSample),
    state.samplesLeftToFill,
  );
  if (wholeSamples === 0) return offset;
  const view = new DataView(chunk.buffer, chunk.byteOffset + offset, bytesAvailable);
  state.sink.writeNextSamples(view, 0, wholeSamples);
  state.samplesLeftToFill -= wholeSamples;
  return offset + wholeSamples * state.layout.bytesPerSample;
}

function stashTrailingPartialSampleIntoCarry(
  state: ChunkFedDecodeState,
  chunk: Uint8Array,
  offset: number,
): void {
  if (state.samplesLeftToFill === 0 || offset >= chunk.byteLength) return;
  const tail = chunk.subarray(offset);
  state.carriedSampleBytes.set(tail, state.carriedByteCount);
  state.carriedByteCount += tail.byteLength;
}

function finishTakingFilledBandPixels(
  state: ChunkFedDecodeState,
): ReadonlyArray<RasterTypedArray> {
  if (state.samplesLeftToFill > 0) {
    throw new Error(
      `ENVI binary stream ended before every sample arrived (${state.samplesLeftToFill} samples missing)`,
    );
  }
  return state.bandPixels;
}

// A sample sink scatters the next N file-order samples into the band arrays.
// Each interleave keeps its own cursor so no per-sample div/mod is needed.
interface EnviSampleSink {
  writeNextSamples(view: DataView, viewByteOffset: number, sampleCount: number): void;
}

function createSampleSinkForInterleave(
  layout: InterleaveLayout,
  descriptor: EnviDataTypeDescriptor,
  bandPixels: RasterTypedArray[],
): EnviSampleSink {
  if (layout.interleave === "bsq") {
    return createBandSequentialSampleSink(layout, descriptor, bandPixels);
  }
  if (layout.interleave === "bil") {
    return createLineInterleavedSampleSink(layout, descriptor, bandPixels);
  }
  return createPixelInterleavedSampleSink(layout, descriptor, bandPixels);
}

type ReadSampleAtIndex = (view: DataView, viewByteOffset: number, sampleIndex: number) => number;

function buildSampleReader(
  layout: InterleaveLayout,
  descriptor: EnviDataTypeDescriptor,
): ReadSampleAtIndex {
  return (view, viewByteOffset, sampleIndex) =>
    descriptor.readSampleAtByteOffset(
      view,
      viewByteOffset + sampleIndex * layout.bytesPerSample,
      layout.isLittleEndian,
    );
}

function createBandSequentialSampleSink(
  layout: InterleaveLayout,
  descriptor: EnviDataTypeDescriptor,
  bandPixels: RasterTypedArray[],
): EnviSampleSink {
  const readSample = buildSampleReader(layout, descriptor);
  const bandLength = layout.samples * layout.lines;
  const cursor = { bandIndex: 0, pixelIndex: 0 };
  return {
    writeNextSamples(view, viewByteOffset, sampleCount) {
      let written = 0;
      while (written < sampleCount) {
        written += writeOneBandSequentialRun(
          { view, viewByteOffset, sampleCount, written },
          cursor,
          { bandPixels, bandLength, readSample },
        );
      }
    },
  };
}

interface SampleRunInput {
  readonly view: DataView;
  readonly viewByteOffset: number;
  readonly sampleCount: number;
  readonly written: number;
}

function writeOneBandSequentialRun(
  input: SampleRunInput,
  cursor: { bandIndex: number; pixelIndex: number },
  target: { bandPixels: RasterTypedArray[]; bandLength: number; readSample: ReadSampleAtIndex },
): number {
  const band = target.bandPixels[cursor.bandIndex]!;
  const run = Math.min(input.sampleCount - input.written, target.bandLength - cursor.pixelIndex);
  for (let i = 0; i < run; i++) {
    band[cursor.pixelIndex + i] = target.readSample(input.view, input.viewByteOffset, input.written + i);
  }
  cursor.pixelIndex += run;
  if (cursor.pixelIndex === target.bandLength) {
    cursor.bandIndex += 1;
    cursor.pixelIndex = 0;
  }
  return run;
}

function createLineInterleavedSampleSink(
  layout: InterleaveLayout,
  descriptor: EnviDataTypeDescriptor,
  bandPixels: RasterTypedArray[],
): EnviSampleSink {
  const readSample = buildSampleReader(layout, descriptor);
  const cursor = { lineIndex: 0, bandIndex: 0, sampleIndex: 0 };
  return {
    writeNextSamples(view, viewByteOffset, sampleCount) {
      let written = 0;
      while (written < sampleCount) {
        written += writeOneLineInterleavedRun(
          { view, viewByteOffset, sampleCount, written },
          cursor,
          { layout, bandPixels, readSample },
        );
      }
    },
  };
}

function writeOneLineInterleavedRun(
  input: SampleRunInput,
  cursor: { lineIndex: number; bandIndex: number; sampleIndex: number },
  target: { layout: InterleaveLayout; bandPixels: RasterTypedArray[]; readSample: ReadSampleAtIndex },
): number {
  const band = target.bandPixels[cursor.bandIndex]!;
  const lineBasePixel = cursor.lineIndex * target.layout.samples;
  const run = Math.min(
    input.sampleCount - input.written,
    target.layout.samples - cursor.sampleIndex,
  );
  for (let i = 0; i < run; i++) {
    band[lineBasePixel + cursor.sampleIndex + i] =
      target.readSample(input.view, input.viewByteOffset, input.written + i);
  }
  advanceLineInterleavedCursor(cursor, run, target.layout);
  return run;
}

function advanceLineInterleavedCursor(
  cursor: { lineIndex: number; bandIndex: number; sampleIndex: number },
  run: number,
  layout: InterleaveLayout,
): void {
  cursor.sampleIndex += run;
  if (cursor.sampleIndex < layout.samples) return;
  cursor.sampleIndex = 0;
  cursor.bandIndex += 1;
  if (cursor.bandIndex < layout.bands) return;
  cursor.bandIndex = 0;
  cursor.lineIndex += 1;
}

function createPixelInterleavedSampleSink(
  layout: InterleaveLayout,
  descriptor: EnviDataTypeDescriptor,
  bandPixels: RasterTypedArray[],
): EnviSampleSink {
  const readSample = buildSampleReader(layout, descriptor);
  const cursor = { pixelIndex: 0, bandIndex: 0 };
  return {
    writeNextSamples(view, viewByteOffset, sampleCount) {
      for (let i = 0; i < sampleCount; i++) {
        bandPixels[cursor.bandIndex]![cursor.pixelIndex] =
          readSample(view, viewByteOffset, i);
        advancePixelInterleavedCursor(cursor, layout.bands);
      }
    },
  };
}

function advancePixelInterleavedCursor(
  cursor: { pixelIndex: number; bandIndex: number },
  bands: number,
): void {
  cursor.bandIndex += 1;
  if (cursor.bandIndex < bands) return;
  cursor.bandIndex = 0;
  cursor.pixelIndex += 1;
}
