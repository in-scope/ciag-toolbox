// Chunked save-image protocol (CT-237), shared between the main process
// handlers (src/main/save-image-dialog.ts + chunked-save-image.ts), the
// preload bridge, and the renderer orchestrator
// (src/renderer/src/lib/image/run-save-image-flow.ts).
//
// WHY CHUNKS: the old image:save-dialog channel carried the WHOLE encoded
// export (image bytes plus an optional ENVI sidecar) in ONE ipcRenderer.invoke
// argument. Serializing a multi-gigabyte structured-clone payload kills the
// SENDING renderer process once V8's ValueSerializer wire buffer doubles past
// Chromium's 2 GiB PartitionAlloc single-allocation cap (the CT-219b/CT-219g
// mechanism; see chunked-opened-image-read-protocol.ts for the canonical
// explanation). A reference-scale ENVI export already cost a multi-second
// renderer gap; a scale10 float32 export (~20 GB sidecar) would die outright.
// Streaming the encoded parts down in small sequential chunks keeps every IPC
// message far below the danger zone at any stack size.
//
// FLOW: begin (resolves the save dialog BEFORE any encoded bytes move, so a
// cancel transfers nothing) -> N chunk uploads per part, written straight to
// the chosen destination paths -> finish (verifies byte counts and keeps the
// files) -> release (renderer-side failure cleanup: closes and DELETES the
// partial files, so a failed export never leaves an invalid file behind).

export const SAVE_IMAGE_BEGIN_CHANNEL = "image:save-begin";
export const SAVE_IMAGE_CHUNK_CHANNEL = "image:save-chunk";
export const SAVE_IMAGE_FINISH_CHANNEL = "image:save-finish";
export const SAVE_IMAGE_RELEASE_CHANNEL = "image:save-release";

export const SAVE_IMAGE_CHUNK_BYTES = 64 * 1024 * 1024;

export type SaveImagePart = "primary" | "sidecar";

export interface SaveImageFileFilter {
  readonly name: string;
  readonly extensions: ReadonlyArray<string>;
}

// The sidecar (an ENVI binary next to its header) crosses as a byte-length
// descriptor here; its bytes follow separately as chunks.
export interface SaveImageSidecarDescriptor {
  readonly extension: string;
  readonly byteLength: number;
}

export interface SaveImageBeginRequest {
  readonly suggestedFileName: string;
  readonly fileFilter: SaveImageFileFilter;
  readonly primaryByteLength: number;
  readonly sidecar?: SaveImageSidecarDescriptor;
}

export type SaveImageBeginResult =
  | { readonly status: "canceled" }
  | { readonly status: "ready"; readonly token: string };

export interface SaveImageChunkRequest {
  readonly token: string;
  readonly part: SaveImagePart;
  // Keep bytes the LAST field (the CT-219b serializer rule); chunks are small,
  // but the rule costs nothing and the shape may be copied elsewhere.
  readonly bytes: Uint8Array;
}

export interface SaveImageFinishRequest {
  readonly token: string;
}

// A finish failure rejects the invoke; the renderer surfaces the message.
export interface SaveImageFinishResult {
  readonly filePath: string;
}

export interface SaveImageReleaseRequest {
  readonly token: string;
}
