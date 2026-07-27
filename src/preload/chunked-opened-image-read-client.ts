import {
  OPENED_IMAGE_READ_ABORT_CHANNEL,
  OPENED_IMAGE_READ_BEGIN_CHANNEL,
  OPENED_IMAGE_READ_CHUNK_CHANNEL,
  OPENED_IMAGE_READ_FINISH_CHANNEL,
  type ChunkedOpenedImageReadBeginResult,
  type ChunkedOpenedImageReadChunkResult,
  type ChunkedOpenedImageReadFinishResult,
  type ChunkedOpenedImageReadTarget,
} from "../shared/chunked-opened-image-read-protocol";
import type {
  OpenedImagesFileEntry,
  OpenImagesDialogFileMetadataEntry,
} from "./index";

// CT-219b: assembles an opened file from the main process's chunked read
// protocol (see src/shared/chunked-opened-image-read-protocol.ts for why the
// old whole-file reply crashed at gigabyte scale). The invoker is injected so
// the assembly logic is unit-testable without electron.
//
// CT-231: an ENVI binary sibling is NEVER reassembled here. A begin result
// carrying a sidecar means the caller opened a .hdr, and that flow must go
// through the renderer's streaming decoder (read-envi-through-chunked-protocol),
// which consumes the binary chunk-by-chunk instead of holding a whole
// multi-gigabyte buffer.

export type ChunkedReadInvoker = (channel: string, payload: unknown) => Promise<unknown>;

export async function readOpenedImageFileThroughChunkedProtocol(
  invoke: ChunkedReadInvoker,
  metadata: OpenImagesDialogFileMetadataEntry,
): Promise<OpenedImagesFileEntry> {
  const begun = (await invoke(OPENED_IMAGE_READ_BEGIN_CHANNEL, {
    filePath: metadata.filePath,
  })) as ChunkedOpenedImageReadBeginResult;
  try {
    return await pullEntireOpenedFileEntry(invoke, metadata, begun);
  } catch (error) {
    await invoke(OPENED_IMAGE_READ_ABORT_CHANNEL, { token: begun.token }).catch(() => undefined);
    throw error;
  }
}

async function pullEntireOpenedFileEntry(
  invoke: ChunkedReadInvoker,
  metadata: OpenImagesDialogFileMetadataEntry,
  begun: ChunkedOpenedImageReadBeginResult,
): Promise<OpenedImagesFileEntry> {
  rejectEnviSidecarAssembly(begun, metadata.fileName);
  const bytes = await pullWholeTarget(invoke, begun.token, "file", begun.fileSizeBytes, metadata.fileName);
  const finished = (await invoke(OPENED_IMAGE_READ_FINISH_CHANNEL, {
    token: begun.token,
  })) as ChunkedOpenedImageReadFinishResult;
  return buildOpenedFileEntry(metadata, bytes, finished.contentHash);
}

function rejectEnviSidecarAssembly(
  begun: ChunkedOpenedImageReadBeginResult,
  fileName: string,
): void {
  if (begun.sidecar === null) return;
  throw new Error(
    `${fileName} has an ENVI binary sibling and must be opened through the streaming ENVI decode path`,
  );
}

async function pullWholeTarget(
  invoke: ChunkedReadInvoker,
  token: string,
  target: ChunkedOpenedImageReadTarget,
  sizeBytes: number,
  fileName: string,
): Promise<Uint8Array> {
  const assembled = allocateBytesForOpenedFileOrThrow(sizeBytes, fileName);
  let offsetBytes = 0;
  while (offsetBytes < sizeBytes) {
    const chunk = (await invoke(OPENED_IMAGE_READ_CHUNK_CHANNEL, {
      token,
      target,
    })) as ChunkedOpenedImageReadChunkResult;
    offsetBytes = appendChunkToAssembledBytes(assembled, chunk, offsetBytes, fileName);
  }
  return assembled;
}

function appendChunkToAssembledBytes(
  assembled: Uint8Array,
  chunk: ChunkedOpenedImageReadChunkResult,
  offsetBytes: number,
  fileName: string,
): number {
  if (chunk.bytes.byteLength === 0 || offsetBytes + chunk.bytes.byteLength > assembled.byteLength) {
    throw new Error(`Reading ${fileName} returned an unexpected amount of data`);
  }
  assembled.set(chunk.bytes, offsetBytes);
  return offsetBytes + chunk.bytes.byteLength;
}

function allocateBytesForOpenedFileOrThrow(sizeBytes: number, fileName: string): Uint8Array {
  try {
    return new Uint8Array(sizeBytes);
  } catch {
    throw new Error(
      `${fileName} is ${formatBytesAsGigabytes(sizeBytes)} and there is not enough memory to open it`,
    );
  }
}

function formatBytesAsGigabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function buildOpenedFileEntry(
  metadata: OpenImagesDialogFileMetadataEntry,
  bytes: Uint8Array,
  contentHash: string,
): OpenedImagesFileEntry {
  return {
    fileName: metadata.fileName,
    filePath: metadata.filePath,
    bytes,
    contentHash,
    fileSizeBytes: metadata.fileSizeBytes,
    mtimeMs: metadata.mtimeMs,
  };
}
