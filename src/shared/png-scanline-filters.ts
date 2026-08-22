// The five PNG scanline filter reconstructions (spec 4.5.2-4.5.6), byte-wise
// over one scanline; a missing previous row (the first scanline) reads as
// zeroes. Shared because both PNG decoders need them: the main-process 16-bit
// decoder (src/main/png16-decode.ts, Node zlib) and the renderer's 8-bit mask
// decoder (renderer/src/lib/masks/mask-png-decode.ts, DecompressionStream).

export function reconstructScanlineBytesInPlace(
  filterType: number,
  row: Uint8Array,
  previousRow: Uint8Array | null,
  bytesPerPixel: number,
): void {
  if (filterType === 0) return;
  if (filterType === 1) return reconstructSubFilter(row, bytesPerPixel);
  if (filterType === 2) return reconstructUpFilter(row, previousRow);
  if (filterType === 3) return reconstructAverageFilter(row, previousRow, bytesPerPixel);
  if (filterType === 4) return reconstructPaethFilter(row, previousRow, bytesPerPixel);
  throw new Error(`The PNG file uses an unknown scanline filter type ${filterType}`);
}

function reconstructSubFilter(row: Uint8Array, bytesPerPixel: number): void {
  for (let index = bytesPerPixel; index < row.length; index += 1) {
    row[index] = (row[index]! + row[index - bytesPerPixel]!) & 0xff;
  }
}

function reconstructUpFilter(row: Uint8Array, previousRow: Uint8Array | null): void {
  if (previousRow === null) return;
  for (let index = 0; index < row.length; index += 1) {
    row[index] = (row[index]! + previousRow[index]!) & 0xff;
  }
}

function reconstructAverageFilter(
  row: Uint8Array,
  previousRow: Uint8Array | null,
  bytesPerPixel: number,
): void {
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= bytesPerPixel ? row[index - bytesPerPixel]! : 0;
    const above = previousRow === null ? 0 : previousRow[index]!;
    row[index] = (row[index]! + ((left + above) >> 1)) & 0xff;
  }
}

function reconstructPaethFilter(
  row: Uint8Array,
  previousRow: Uint8Array | null,
  bytesPerPixel: number,
): void {
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= bytesPerPixel ? row[index - bytesPerPixel]! : 0;
    const above = previousRow === null ? 0 : previousRow[index]!;
    const upperLeft =
      previousRow !== null && index >= bytesPerPixel ? previousRow[index - bytesPerPixel]! : 0;
    row[index] = (row[index]! + paethPredictor(left, above, upperLeft)) & 0xff;
  }
}

function paethPredictor(left: number, above: number, upperLeft: number): number {
  const initial = left + above - upperLeft;
  const distanceLeft = Math.abs(initial - left);
  const distanceAbove = Math.abs(initial - above);
  const distanceUpperLeft = Math.abs(initial - upperLeft);
  if (distanceLeft <= distanceAbove && distanceLeft <= distanceUpperLeft) return left;
  if (distanceAbove <= distanceUpperLeft) return above;
  return upperLeft;
}
