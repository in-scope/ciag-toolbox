// CRC-32 over the reflected IEEE 802.3 polynomial: the checksum BOTH the PNG
// chunk framing (lib/masks/png-chunks.ts) and the zip file headers
// (lib/masks/zip-store-writer.ts) are specified against, so the table and the
// fold live here instead of once per format.

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

export function computeCrc32OfParts(parts: ReadonlyArray<Uint8Array>): number {
  let crc = 0xffffffff;
  for (const part of parts) {
    for (const byte of part) {
      crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function computeCrc32OfBytes(bytes: Uint8Array): number {
  return computeCrc32OfParts([bytes]);
}
