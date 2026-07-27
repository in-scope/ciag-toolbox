// CT-235: shared slicer for chunk-emitting encoders. An already-materialized
// small buffer (an ENVI header, a TIFF header block) still crosses the chunked
// save protocol in bounded pieces, so every uploaded chunk respects the caller's
// chunk-size ceiling regardless of which part it came from.
export type ByteChunkConsumer = (bytes: Uint8Array) => Promise<void>;

export async function emitBufferInBoundedSlicesInOrder(
  bytes: Uint8Array,
  maxChunkBytes: number,
  onChunk: ByteChunkConsumer,
): Promise<void> {
  const sliceBytes = Math.max(1, Math.floor(maxChunkBytes));
  for (let offset = 0; offset < bytes.byteLength; offset += sliceBytes) {
    await onChunk(bytes.slice(offset, Math.min(offset + sliceBytes, bytes.byteLength)));
  }
}
