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

// CT-273: a folder export (PNG stack, one file per band) addresses its parts
// by band-file index instead of the primary/sidecar pair.
export type SaveImageFolderFilePart = `file-${number}`;

export type SaveImagePart = "primary" | "sidecar" | SaveImageFolderFilePart;

export function saveImageFolderFilePartName(fileIndex: number): SaveImageFolderFilePart {
  return `file-${fileIndex}`;
}

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

// CT-271: a 16-bit PNG is encoded IN MAIN (Node zlib) because the renderer has
// no lossless 16-bit PNG encoder (canvas encodes are 8-bit). The renderer
// streams the RAW row-major big-endian uint16 samples as ordinary chunks;
// primaryByteLength describes that raw payload (width x height x 2), and the
// session deflates the filtered scanlines into the destination file as the
// chunks arrive, so neither process ever holds the encoded export whole.
export interface SaveImagePngSixteenBitGrayscaleEncoding {
  readonly kind: "png-16-bit-grayscale";
  readonly width: number;
  readonly height: number;
}

export type SaveImagePartEncoding = SaveImagePngSixteenBitGrayscaleEncoding;

export interface SaveImageSingleFileBeginRequest {
  readonly suggestedFileName: string;
  readonly fileFilter: SaveImageFileFilter;
  readonly primaryByteLength: number;
  readonly primaryEncoding?: SaveImagePartEncoding;
  readonly sidecar?: SaveImageSidecarDescriptor;
}

// CT-273: a folder export begins with a directory pick instead of a save
// dialog. Each described file's chunks arrive under the part name
// saveImageFolderFilePartName(index); an encoding descriptor means that file's
// chunks are RAW payload bytes encoded in main, exactly like the primary part.
export interface SaveImageFolderFileDescriptor {
  readonly fileName: string;
  readonly byteLength: number;
  readonly encoding?: SaveImagePartEncoding;
}

export interface SaveImageFolderBeginRequest {
  readonly destination: "folder";
  readonly files: ReadonlyArray<SaveImageFolderFileDescriptor>;
}

export type SaveImageBeginRequest =
  | SaveImageSingleFileBeginRequest
  | SaveImageFolderBeginRequest;

export function isSaveImageFolderBeginRequest(
  request: SaveImageBeginRequest,
): request is SaveImageFolderBeginRequest {
  return (request as SaveImageFolderBeginRequest).destination === "folder";
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
// filePath is the saved primary file, or the destination folder for a
// CT-273 folder export.
export interface SaveImageFinishResult {
  readonly filePath: string;
}

export interface SaveImageReleaseRequest {
  readonly token: string;
}
