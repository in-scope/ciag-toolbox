import {
  PNG16_DECODED_CHUNK_BYTES,
  totalDecodedPng16ByteLength,
  type ChunkedPng16DecodeAbortRequest,
  type ChunkedPng16DecodeBeginRequest,
  type ChunkedPng16DecodeBeginResult,
  type ChunkedPng16DecodeChunkRequest,
  type ChunkedPng16DecodeChunkResult,
  type ChunkedPng16DecodeFinishRequest,
} from "@shared/chunked-png16-decode-protocol";

import { allocateTypedArrayLikeBandOrThrow } from "@/lib/image/raster-allocation";
import type { RasterImage } from "@/lib/image/raster-image";
import {
  reportMultiUnitWorkStarting,
  reportProgressFractionAndYield,
  type UnitProgressCallback,
} from "@/lib/image/unit-progress";

// CT-272: the renderer side of the chunked 16-bit PNG decode. Main re-reads
// the picked file from disk, inflates and unfilters it with Node zlib, and
// streams the raw big-endian samples back; this module scatters them into
// per-band Uint16Arrays (grayscale -> one band; 16-bit color -> a 3-band
// raster tagged rgb, mirroring the promote-source-to-raster channel model).

export interface Png16DecodeApi {
  begin(request: ChunkedPng16DecodeBeginRequest): Promise<ChunkedPng16DecodeBeginResult>;
  readChunk(request: ChunkedPng16DecodeChunkRequest): Promise<ChunkedPng16DecodeChunkResult>;
  finish(request: ChunkedPng16DecodeFinishRequest): Promise<void>;
  abort(request: ChunkedPng16DecodeAbortRequest): Promise<void>;
}

const UINT16_BAND_TEMPLATE = new Uint16Array(0);
const RGB_BAND_LABELS: ReadonlyArray<string> = ["Red", "Green", "Blue"];
const RGB_BAND_ORIGINAL_NUMBERS: ReadonlyArray<number> = [1, 2, 3];

export async function loadPng16RasterThroughChunkedDecode(
  api: Png16DecodeApi,
  filePath: string,
  onDecodeProgress?: UnitProgressCallback,
): Promise<RasterImage> {
  const begun = await api.begin({ filePath });
  try {
    return await streamDecodedSamplesIntoRaster(api, begun, onDecodeProgress);
  } catch (error) {
    await api.abort({ token: begun.token }).catch(() => undefined);
    throw error;
  }
}

async function streamDecodedSamplesIntoRaster(
  api: Png16DecodeApi,
  begun: ChunkedPng16DecodeBeginResult,
  onDecodeProgress?: UnitProgressCallback,
): Promise<RasterImage> {
  const scatter = createBigEndianUint16SampleScatter(begun);
  await pullEveryDecodedChunk(api, begun, scatter, onDecodeProgress);
  await api.finish({ token: begun.token });
  return buildRasterFromScatteredBands(begun, scatter.takeBands());
}

async function pullEveryDecodedChunk(
  api: Png16DecodeApi,
  begun: ChunkedPng16DecodeBeginResult,
  scatter: BigEndianUint16SampleScatter,
  onDecodeProgress?: UnitProgressCallback,
): Promise<void> {
  const totalBytes = totalDecodedPng16ByteLength(begun);
  reportMultiUnitWorkStarting(onDecodeProgress, Math.ceil(totalBytes / PNG16_DECODED_CHUNK_BYTES));
  let consumedBytes = 0;
  while (consumedBytes < totalBytes) {
    const chunk = await api.readChunk({ token: begun.token });
    assertChunkAdvancesTheDecode(chunk, consumedBytes, totalBytes);
    scatter.consumeChunk(chunk.bytes);
    consumedBytes += chunk.bytes.byteLength;
    await reportProgressFractionAndYield(onDecodeProgress, consumedBytes / totalBytes);
  }
}

function assertChunkAdvancesTheDecode(
  chunk: ChunkedPng16DecodeChunkResult,
  consumedBytes: number,
  totalBytes: number,
): void {
  if (chunk.bytes.byteLength === 0 || consumedBytes + chunk.bytes.byteLength > totalBytes) {
    throw new Error("Decoding the 16-bit PNG returned an unexpected amount of data");
  }
}

function buildRasterFromScatteredBands(
  begun: ChunkedPng16DecodeBeginResult,
  bands: ReadonlyArray<Uint16Array>,
): RasterImage {
  const base = {
    bandPixels: bands,
    width: begun.width,
    height: begun.height,
    bitsPerSample: 16,
    sampleFormat: "uint" as const,
    bandCount: begun.channelCount,
  };
  if (begun.channelCount !== 3) return base;
  return {
    ...base,
    bandLabels: RGB_BAND_LABELS,
    bandOriginalNumbers: RGB_BAND_ORIGINAL_NUMBERS,
    colorInterpretation: "rgb",
  };
}

// The decoded stream is row-major, channel-interleaved, big-endian uint16;
// chunk boundaries can split a sample, so a leftover high byte carries over.
export interface BigEndianUint16SampleScatter {
  consumeChunk(bytes: Uint8Array): void;
  takeBands(): ReadonlyArray<Uint16Array>;
}

export function createBigEndianUint16SampleScatter(
  shape: Pick<ChunkedPng16DecodeBeginResult, "width" | "height" | "channelCount">,
): BigEndianUint16SampleScatter {
  const pixelCount = shape.width * shape.height;
  const bands = Array.from({ length: shape.channelCount }, () =>
    allocateTypedArrayLikeBandOrThrow(UINT16_BAND_TEMPLATE, pixelCount),
  );
  const state = { sampleIndex: 0, carryHighByte: null as number | null };
  return {
    consumeChunk: (bytes) => scatterChunkIntoBands(bands, shape.channelCount, state, bytes),
    takeBands: () => takeBandsAssertingEverySampleArrived(bands, state, pixelCount, shape.channelCount),
  };
}

interface ScatterState {
  sampleIndex: number;
  carryHighByte: number | null;
}

function scatterChunkIntoBands(
  bands: ReadonlyArray<Uint16Array>,
  channelCount: number,
  state: ScatterState,
  bytes: Uint8Array,
): void {
  let index = takeCarriedSampleIfAny(bands, channelCount, state, bytes);
  for (; index + 1 < bytes.length; index += 2) {
    writeSampleIntoBands(bands, channelCount, state, (bytes[index]! << 8) | bytes[index + 1]!);
  }
  state.carryHighByte = index < bytes.length ? bytes[index]! : null;
}

function takeCarriedSampleIfAny(
  bands: ReadonlyArray<Uint16Array>,
  channelCount: number,
  state: ScatterState,
  bytes: Uint8Array,
): number {
  if (state.carryHighByte === null || bytes.length === 0) return 0;
  writeSampleIntoBands(bands, channelCount, state, (state.carryHighByte << 8) | bytes[0]!);
  state.carryHighByte = null;
  return 1;
}

function writeSampleIntoBands(
  bands: ReadonlyArray<Uint16Array>,
  channelCount: number,
  state: ScatterState,
  value: number,
): void {
  const channel = state.sampleIndex % channelCount;
  const pixelIndex = (state.sampleIndex - channel) / channelCount;
  bands[channel]![pixelIndex] = value;
  state.sampleIndex += 1;
}

function takeBandsAssertingEverySampleArrived(
  bands: ReadonlyArray<Uint16Array>,
  state: ScatterState,
  pixelCount: number,
  channelCount: number,
): ReadonlyArray<Uint16Array> {
  if (state.carryHighByte !== null || state.sampleIndex !== pixelCount * channelCount) {
    throw new Error("Decoding the 16-bit PNG returned an unexpected amount of data");
  }
  return bands;
}
