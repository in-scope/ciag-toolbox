// Chunked open-images file read protocol (CT-219b), shared between the main
// process handlers (src/main/chunked-opened-image-read*.ts) and the preload
// client (src/preload/chunked-opened-image-read-client.ts).
//
// WHY CHUNKS: a single ipcMain.handle reply carrying a whole multi-gigabyte
// file is fatal. V8's ValueSerializer grows its wire buffer by DOUBLING, and
// Chromium's PartitionAlloc refuses single allocations of 2 GiB or more, so
// serializing any field AFTER a buffer of roughly 1 GiB forces a doubled
// reallocation over that cap and the SENDING process dies instantly with no
// error surface (the CT-219b "open a 1.5 GB TIFF and the window vanishes"
// crash - the MAIN process was dying, not the renderer). Streaming the file
// in small chunks keeps every IPC message far below the danger zone at any
// file size the 16 GiB openable limit allows.
//
// RULE for any IPC reply shape elsewhere: a large Uint8Array must be the LAST
// field serialized, and payloads that can reach a gibibyte must be chunked.

export const OPENED_IMAGE_READ_BEGIN_CHANNEL = "image:open-images-read-begin";
export const OPENED_IMAGE_READ_CHUNK_CHANNEL = "image:open-images-read-chunk";
export const OPENED_IMAGE_READ_FINISH_CHANNEL = "image:open-images-read-finish";
export const OPENED_IMAGE_READ_ABORT_CHANNEL = "image:open-images-read-abort";

export const OPENED_IMAGE_READ_CHUNK_BYTES = 64 * 1024 * 1024;

export interface ChunkedOpenedImageReadBeginRequest {
  readonly filePath: string;
}

export interface ChunkedOpenedImageReadSidecarInfo {
  readonly fileName: string;
  readonly sizeBytes: number;
}

export interface ChunkedOpenedImageReadBeginResult {
  readonly token: string;
  readonly fileSizeBytes: number;
  readonly sidecar: ChunkedOpenedImageReadSidecarInfo | null;
}

export type ChunkedOpenedImageReadTarget = "file" | "sidecar";

export interface ChunkedOpenedImageReadChunkRequest {
  readonly token: string;
  readonly target: ChunkedOpenedImageReadTarget;
}

export interface ChunkedOpenedImageReadChunkResult {
  readonly done: boolean;
  // Keep bytes the LAST field (see the serializer note above); chunks are
  // small, but the rule costs nothing and the shape may be copied elsewhere.
  readonly bytes: Uint8Array;
}

export interface ChunkedOpenedImageReadFinishRequest {
  readonly token: string;
}

export interface ChunkedOpenedImageReadFinishResult {
  readonly contentHash: string;
}
