// CT-303: PNG chunk framing for the renderer-side mask codec. A PNG file is
// its 8-byte signature followed by length-prefixed, CRC-checked chunks; the
// encoder builds them and the decoder walks them. The IHDR fields themselves
// are parsed by the shared sniffing module so both processes read the header
// the same way.

export const PNG_SIGNATURE_BYTE_LENGTH = 8;

export const PNG_SIGNATURE: Uint8Array = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

export interface PngChunk {
  readonly chunkType: string;
  readonly data: Uint8Array;
}

export function buildPngChunkBytes(chunkType: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from(chunkType, (character) => character.charCodeAt(0));
  const chunk = new Uint8Array(12 + data.byteLength);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.byteLength);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.byteLength, computeCrc32OfParts([typeBytes, data]));
  return chunk;
}

export function listPngChunksAfterSignature(fileBytes: Uint8Array): ReadonlyArray<PngChunk> {
  const chunks: PngChunk[] = [];
  let offset = PNG_SIGNATURE_BYTE_LENGTH;
  while (offset + 12 <= fileBytes.byteLength) {
    const dataLength = readBigEndianUint32At(fileBytes, offset);
    chunks.push(readChunkAtOffset(fileBytes, offset, dataLength));
    offset += 12 + dataLength;
  }
  return chunks;
}

function readChunkAtOffset(
  fileBytes: Uint8Array,
  offset: number,
  dataLength: number,
): PngChunk {
  return {
    chunkType: String.fromCharCode(...fileBytes.subarray(offset + 4, offset + 8)),
    data: fileBytes.subarray(offset + 8, offset + 8 + dataLength),
  };
}

function readBigEndianUint32At(bytes: Uint8Array, offset: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(offset);
}

export function concatenateByteArrays(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  return joined;
}

const CRC32_TABLE = buildCrc32Table();

function buildCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    table[index] = foldCrc32TableEntry(index);
  }
  return table;
}

function foldCrc32TableEntry(seed: number): number {
  let value = seed;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
}

function computeCrc32OfParts(parts: ReadonlyArray<Uint8Array>): number {
  let crc = 0xffffffff;
  for (const part of parts) {
    for (const byte of part) {
      crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
