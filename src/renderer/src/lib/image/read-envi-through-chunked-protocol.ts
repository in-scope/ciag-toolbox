import {
  type ChunkedOpenedImageReadAbortRequest,
  type ChunkedOpenedImageReadBeginRequest,
  type ChunkedOpenedImageReadBeginResult,
  type ChunkedOpenedImageReadChunkRequest,
  type ChunkedOpenedImageReadChunkResult,
  type ChunkedOpenedImageReadFinishRequest,
  type ChunkedOpenedImageReadFinishResult,
} from "@shared/chunked-opened-image-read-protocol";

import type { OpenedFileForGrouping } from "@/lib/image/group-opened-files";
import { buildRasterImageFromEnviHeaderAndBandPixels } from "@/lib/image/load-envi";
import { parseEnviHeaderText, type EnviHeader } from "@/lib/image/parse-envi-header";
import {
  createChunkFedEnviBandDecoder,
  type ChunkFedEnviBandDecoder,
} from "@/lib/image/read-envi-binary-from-chunks";
import {
  reportMultiUnitWorkStarting,
  reportProgressFractionAndYield,
  type UnitProgressCallback,
} from "@/lib/image/unit-progress";

// CT-231: the streaming ENVI open path. An opened .hdr pulls its small header
// text whole, then feeds the binary sibling's 64 MiB protocol chunks straight
// into the chunk-fed decoder, so the multi-gigabyte binary never exists as one
// buffer in any process (the preload whole-file reassembly is bypassed for
// ENVI binaries). The main-process begin still enforces the 16 GiB openable
// limit, and progress reports one determinate fraction per consumed chunk.

export interface ChunkedOpenedImageReadApi {
  begin(request: ChunkedOpenedImageReadBeginRequest): Promise<ChunkedOpenedImageReadBeginResult>;
  readChunk(request: ChunkedOpenedImageReadChunkRequest): Promise<ChunkedOpenedImageReadChunkResult>;
  finish(request: ChunkedOpenedImageReadFinishRequest): Promise<ChunkedOpenedImageReadFinishResult>;
  abort(request: ChunkedOpenedImageReadAbortRequest): Promise<void>;
}

export async function readAndDecodeEnviHeaderFileStreamingChunks(
  api: ChunkedOpenedImageReadApi,
  metadata: ToolboxOpenImagesDialogFileMetadataEntry,
  onDecodeProgress?: UnitProgressCallback,
): Promise<OpenedFileForGrouping> {
  const begun = await api.begin({ filePath: metadata.filePath });
  try {
    return await pullHeaderThenStreamDecodeBinary(api, begun, metadata, onDecodeProgress);
  } catch (error) {
    await api.abort({ token: begun.token }).catch(() => undefined);
    return buildEntryForFailedEnviDecode(metadata, error);
  }
}

async function pullHeaderThenStreamDecodeBinary(
  api: ChunkedOpenedImageReadApi,
  begun: ChunkedOpenedImageReadBeginResult,
  metadata: ToolboxOpenImagesDialogFileMetadataEntry,
  onDecodeProgress?: UnitProgressCallback,
): Promise<OpenedFileForGrouping> {
  const headerBytes = await pullWholeHeaderFileTarget(api, begun, metadata.fileName);
  const sidecar = requireEnviBinarySidecarInfo(begun, metadata.fileName);
  const header = parseEnviHeaderText(new TextDecoder("utf-8").decode(headerBytes));
  const decoder = createDecoderMappingAllocationFailure(header, sidecar.sizeBytes, sidecar.fileName);
  await streamSidecarChunksIntoDecoder(
    api,
    { token: begun.token, sizeBytes: sidecar.sizeBytes, fileName: sidecar.fileName, bands: header.bands },
    decoder,
    onDecodeProgress,
  );
  return finishSessionAndBuildDecodedEntry(api, { begun, metadata, header, decoder, sidecar });
}

function requireEnviBinarySidecarInfo(
  begun: ChunkedOpenedImageReadBeginResult,
  fileName: string,
): { fileName: string; sizeBytes: number } {
  if (begun.sidecar === null) {
    throw new Error(
      `ENVI header ${fileName} requires a sibling binary file (.bin/.dat/.img) but none was provided`,
    );
  }
  return begun.sidecar;
}

async function pullWholeHeaderFileTarget(
  api: ChunkedOpenedImageReadApi,
  begun: ChunkedOpenedImageReadBeginResult,
  fileName: string,
): Promise<Uint8Array> {
  const assembled = new Uint8Array(begun.fileSizeBytes);
  let offsetBytes = 0;
  while (offsetBytes < begun.fileSizeBytes) {
    const chunk = await api.readChunk({ token: begun.token, target: "file" });
    assertChunkAdvancesTheStream(chunk, offsetBytes, begun.fileSizeBytes, fileName);
    assembled.set(chunk.bytes, offsetBytes);
    offsetBytes += chunk.bytes.byteLength;
  }
  return assembled;
}

interface SidecarStreamPlan {
  readonly token: string;
  readonly sizeBytes: number;
  readonly fileName: string;
  readonly bands: number;
}

async function streamSidecarChunksIntoDecoder(
  api: ChunkedOpenedImageReadApi,
  plan: SidecarStreamPlan,
  decoder: ChunkFedEnviBandDecoder,
  onDecodeProgress?: UnitProgressCallback,
): Promise<void> {
  reportMultiUnitWorkStarting(onDecodeProgress, plan.bands);
  let consumedBytes = 0;
  while (consumedBytes < plan.sizeBytes) {
    const chunk = await api.readChunk({ token: plan.token, target: "sidecar" });
    assertChunkAdvancesTheStream(chunk, consumedBytes, plan.sizeBytes, plan.fileName);
    decoder.consumeChunk(chunk.bytes);
    consumedBytes += chunk.bytes.byteLength;
    await reportProgressFractionAndYield(onDecodeProgress, consumedBytes / plan.sizeBytes);
  }
}

function assertChunkAdvancesTheStream(
  chunk: ChunkedOpenedImageReadChunkResult,
  consumedBytes: number,
  totalBytes: number,
  fileName: string,
): void {
  if (chunk.bytes.byteLength === 0 || consumedBytes + chunk.bytes.byteLength > totalBytes) {
    throw new Error(`Reading ${fileName} returned an unexpected amount of data`);
  }
}

function createDecoderMappingAllocationFailure(
  header: EnviHeader,
  binarySizeBytes: number,
  fileName: string,
): ChunkFedEnviBandDecoder {
  try {
    return createChunkFedEnviBandDecoder(header, binarySizeBytes);
  } catch (error) {
    if (error instanceof RangeError) {
      throw new Error(
        `${fileName} is ${formatBytesAsGigabytes(binarySizeBytes)} and there is not enough memory to open it`,
      );
    }
    throw error;
  }
}

function formatBytesAsGigabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

interface DecodedEnviSessionParts {
  readonly begun: ChunkedOpenedImageReadBeginResult;
  readonly metadata: ToolboxOpenImagesDialogFileMetadataEntry;
  readonly header: EnviHeader;
  readonly decoder: ChunkFedEnviBandDecoder;
  readonly sidecar: { fileName: string; sizeBytes: number };
}

async function finishSessionAndBuildDecodedEntry(
  api: ChunkedOpenedImageReadApi,
  parts: DecodedEnviSessionParts,
): Promise<OpenedFileForGrouping> {
  const raster = buildRasterImageFromEnviHeaderAndBandPixels(
    parts.header,
    parts.decoder.finishAndTakeBandPixels(),
  );
  const finished = await api.finish({ token: parts.begun.token });
  return {
    fileName: parts.metadata.fileName,
    filePath: parts.metadata.filePath,
    fileSizeBytes: parts.metadata.fileSizeBytes,
    mtimeMs: parts.metadata.mtimeMs,
    source: { kind: "raster", raster },
    decodeError: null,
    contentHash: finished.contentHash,
    sidecarFileName: parts.sidecar.fileName,
    sidecarSizeBytes: parts.sidecar.sizeBytes,
  };
}

function buildEntryForFailedEnviDecode(
  metadata: ToolboxOpenImagesDialogFileMetadataEntry,
  error: unknown,
): OpenedFileForGrouping {
  return {
    fileName: metadata.fileName,
    filePath: metadata.filePath,
    fileSizeBytes: metadata.fileSizeBytes,
    mtimeMs: metadata.mtimeMs,
    source: null,
    decodeError: error instanceof Error ? error.message : String(error),
    contentHash: "",
  };
}
