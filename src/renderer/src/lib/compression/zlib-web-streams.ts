// Zlib (RFC 1950) compression in the renderer, where node:zlib does not exist.
// Chromium's CompressionStream/DecompressionStream speak the same "deflate"
// wrapper PNG's IDAT stream uses, so the mask PNG codec
// (lib/masks/mask-png-encode.ts and mask-png-decode.ts) needs no bundled
// deflate implementation and no round trip through the main process.

export async function compressBytesToZlibBytes(bytes: Uint8Array): Promise<Uint8Array> {
  return pumpBytesThroughTransform(bytes, new CompressionStream("deflate"));
}

export async function decompressZlibBytes(bytes: Uint8Array): Promise<Uint8Array> {
  return pumpBytesThroughTransform(bytes, new DecompressionStream("deflate"));
}

// The transform is described by what this module actually writes and reads
// (CompressionStream types its writable side over the wider BufferSource).
interface ByteTransformStream {
  readonly writable: WritableStream<BufferSource>;
  readonly readable: ReadableStream<Uint8Array>;
}

// The output is collected BEFORE the input is written: a transform stream
// whose readable side is never drained blocks its writer once its queue fills.
async function pumpBytesThroughTransform(
  bytes: Uint8Array,
  transform: ByteTransformStream,
): Promise<Uint8Array> {
  const collected = new Response(transform.readable).arrayBuffer();
  await writeAllBytesClosingWriter(transform.writable, bytes);
  return new Uint8Array(await collected);
}

async function writeAllBytesClosingWriter(
  writable: WritableStream<BufferSource>,
  bytes: Uint8Array,
): Promise<void> {
  const writer = writable.getWriter();
  await writer.write(copyIntoPlainArrayBufferView(bytes));
  await writer.close();
}

// A stream chunk must be backed by a plain ArrayBuffer (a Uint8Array over a
// SharedArrayBuffer is not a BufferSource), so the caller's view is copied
// into one rather than being narrowed with a cast.
function copyIntoPlainArrayBufferView(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copied = new Uint8Array(bytes.byteLength);
  copied.set(bytes);
  return copied;
}
