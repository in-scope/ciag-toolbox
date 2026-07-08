import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// CT-220: a runtime-generated large multiband uint16 TIFF (NOT committed) whose decode
// reliably outlasts the busy indicator's anti-flash delay, so the loading-progress spec
// can observe the determinate percentage overlay. Every band holds ONE constant value
// (band N reads N * 100 at every pixel), so any hovered pixel is an exact oracle.

export const LOADING_PROGRESS_STACK = {
  fileName: "loading-progress-stack.tif",
  width: 3200,
  height: 2400,
  bandCount: 16,
} as const;

export function loadingProgressStackValueForBand(bandIndexZeroBased: number): number {
  return (bandIndexZeroBased + 1) * 100;
}

export interface GeneratedLoadingProgressStack {
  readonly filePath: string;
  readonly directory: string;
}

export async function writeTemporaryLoadingProgressStackTiff(): Promise<GeneratedLoadingProgressStack> {
  const directory = await mkdtemp(join(tmpdir(), "msi-e2e-loading-progress-"));
  const filePath = join(directory, LOADING_PROGRESS_STACK.fileName);
  await writeFile(filePath, Buffer.concat(buildMultiPageTiffBuffers()));
  return { filePath, directory };
}

// Classic little-endian TIFF, one IFD immediately followed by one uncompressed strip
// per band - the same layout as e2e/fixtures/generate-fixtures.mjs and
// scripts/generate-scale-audit-stack.mjs.

const TIFF_TYPE_SHORT = 3;
const TIFF_TYPE_LONG = 4;
const TIFF_ENTRY_COUNT = 10;
const TIFF_IFD_BYTE_SIZE = 2 + TIFF_ENTRY_COUNT * 12 + 4;
const TIFF_FIRST_IFD_OFFSET = 8;

interface TiffIfdEntry {
  readonly tag: number;
  readonly type: number;
  readonly value: number;
}

function buildMultiPageTiffBuffers(): Buffer[] {
  const buffers = [encodeLittleEndianTiffHeader()];
  for (let bandIndex = 0; bandIndex < LOADING_PROGRESS_STACK.bandCount; bandIndex += 1) {
    buffers.push(encodeIfdForBand(bandIndex), encodeConstantBandStrip(bandIndex));
  }
  return buffers;
}

function encodeLittleEndianTiffHeader(): Buffer {
  const header = Buffer.alloc(TIFF_FIRST_IFD_OFFSET);
  header.write("II", 0, "ascii");
  header.writeUInt16LE(42, 2);
  header.writeUInt32LE(TIFF_FIRST_IFD_OFFSET, 4);
  return header;
}

function computePageBlockSize(): number {
  return TIFF_IFD_BYTE_SIZE + LOADING_PROGRESS_STACK.width * LOADING_PROGRESS_STACK.height * 2;
}

function computeIfdOffsetForBand(bandIndex: number): number {
  return TIFF_FIRST_IFD_OFFSET + bandIndex * computePageBlockSize();
}

function encodeIfdForBand(bandIndex: number): Buffer {
  const ifdOffset = computeIfdOffsetForBand(bandIndex);
  const stripOffset = ifdOffset + TIFF_IFD_BYTE_SIZE;
  const isLastBand = bandIndex === LOADING_PROGRESS_STACK.bandCount - 1;
  const nextIfdOffset = isLastBand ? 0 : computeIfdOffsetForBand(bandIndex + 1);
  return encodeIfdBytes(buildTiffPageEntries(stripOffset), nextIfdOffset);
}

function buildTiffPageEntries(stripOffset: number): TiffIfdEntry[] {
  const { width, height } = LOADING_PROGRESS_STACK;
  return [
    { tag: 256, type: TIFF_TYPE_SHORT, value: width },
    { tag: 257, type: TIFF_TYPE_SHORT, value: height },
    { tag: 258, type: TIFF_TYPE_SHORT, value: 16 },
    { tag: 259, type: TIFF_TYPE_SHORT, value: 1 },
    { tag: 262, type: TIFF_TYPE_SHORT, value: 1 },
    { tag: 273, type: TIFF_TYPE_LONG, value: stripOffset },
    { tag: 277, type: TIFF_TYPE_SHORT, value: 1 },
    { tag: 278, type: TIFF_TYPE_LONG, value: height },
    { tag: 279, type: TIFF_TYPE_LONG, value: width * height * 2 },
    { tag: 339, type: TIFF_TYPE_SHORT, value: 1 },
  ];
}

function encodeIfdBytes(entries: ReadonlyArray<TiffIfdEntry>, nextIfdOffset: number): Buffer {
  const bytes = Buffer.alloc(TIFF_IFD_BYTE_SIZE);
  bytes.writeUInt16LE(entries.length, 0);
  entries.forEach((entry, entryIndex) => writeIfdEntry(bytes, 2 + entryIndex * 12, entry));
  bytes.writeUInt32LE(nextIfdOffset, 2 + entries.length * 12);
  return bytes;
}

function writeIfdEntry(bytes: Buffer, offset: number, entry: TiffIfdEntry): void {
  bytes.writeUInt16LE(entry.tag, offset);
  bytes.writeUInt16LE(entry.type, offset + 2);
  bytes.writeUInt32LE(1, offset + 4);
  if (entry.type === TIFF_TYPE_SHORT) bytes.writeUInt16LE(entry.value, offset + 8);
  else bytes.writeUInt32LE(entry.value, offset + 8);
}

function encodeConstantBandStrip(bandIndex: number): Buffer {
  const sampleCount = LOADING_PROGRESS_STACK.width * LOADING_PROGRESS_STACK.height;
  const samples = new Uint16Array(sampleCount);
  samples.fill(loadingProgressStackValueForBand(bandIndex));
  return Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
}
