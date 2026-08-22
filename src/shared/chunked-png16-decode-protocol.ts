// Chunked 16-bit PNG decode protocol (CT-272), shared between the main
// process session store (src/main/chunked-png16-decode.ts) and the renderer
// orchestrator (renderer/src/lib/image/load-png16.ts) via thin preload
// wrappers.
//
// WHY MAIN DECODES: Chromium's createImageBitmap silently downscales 16-bit
// PNGs to 8 bits, so the real samples are only reachable through a Node zlib
// inflate. The decode stays in MAIN (the renderer never re-uploads the file;
// main re-reads it from disk by path) and the DECODED payload - which can be
// far larger than the compressed file - streams back in bounded chunks per
// the CT-219b IPC size rules. Chunk bytes are the unfiltered scanline
// samples: row-major, channel-interleaved, big-endian uint16 per PNG spec.

export const PNG16_DECODE_BEGIN_CHANNEL = "image:png16-decode-begin";
export const PNG16_DECODE_CHUNK_CHANNEL = "image:png16-decode-chunk";
export const PNG16_DECODE_FINISH_CHANNEL = "image:png16-decode-finish";
export const PNG16_DECODE_ABORT_CHANNEL = "image:png16-decode-abort";

export const PNG16_DECODED_CHUNK_BYTES = 16 * 1024 * 1024;

export interface ChunkedPng16DecodeBeginRequest {
  readonly filePath: string;
}

export interface ChunkedPng16DecodeBeginResult {
  readonly token: string;
  readonly width: number;
  readonly height: number;
  readonly channelCount: number;
}

export interface ChunkedPng16DecodeChunkRequest {
  readonly token: string;
}

export interface ChunkedPng16DecodeChunkResult {
  readonly done: boolean;
  // Keep bytes the LAST serialized field (CT-219b serializer rule).
  readonly bytes: Uint8Array;
}

export interface ChunkedPng16DecodeFinishRequest {
  readonly token: string;
}

export interface ChunkedPng16DecodeAbortRequest {
  readonly token: string;
}

export function totalDecodedPng16ByteLength(
  begin: Pick<ChunkedPng16DecodeBeginResult, "width" | "height" | "channelCount">,
): number {
  return begin.width * begin.height * begin.channelCount * 2;
}
