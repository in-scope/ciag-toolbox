// Joining byte parts into one buffer is the last step of every binary format
// this renderer writes (PNG chunks, zip archives), so the loop lives once
// here rather than once per codec.

export function concatenateByteArrays(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const joined = new Uint8Array(sumByteLengths(parts));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  return joined;
}

export function sumByteLengths(parts: ReadonlyArray<Uint8Array>): number {
  return parts.reduce((total, part) => total + part.byteLength, 0);
}
