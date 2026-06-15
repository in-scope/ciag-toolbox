import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A throwaway single-band uint16 TIFF of arbitrary dimensions, written under
// os.tmpdir. Every committed fixture is 4x4, so the flat-field "wrong-size
// reference is rejected" case (CT-137) needs a differently sized raster
// reference; this builds one deterministically without touching the committed
// set. The encoder mirrors the single-page classic TIFF in generate-fixtures.mjs.

const TIFF_HEADER_BYTE_SIZE = 8;
const TIFF_ENTRY_COUNT = 10;
const TIFF_IFD_BYTE_SIZE = 2 + TIFF_ENTRY_COUNT * 12 + 4;
const TIFF_TYPE_SHORT = 3;
const TIFF_TYPE_LONG = 4;

export interface SingleBandTiffRequest {
  readonly width: number;
  readonly height: number;
  readonly fillValue: number;
}

export async function writeTemporarySingleBandUint16Tiff(
  request: SingleBandTiffRequest,
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "msi-e2e-tiff-"));
  const filePath = join(directory, `reference-${request.width}x${request.height}.tif`);
  await writeFile(filePath, encodeSingleBandUint16Tiff(request));
  return filePath;
}

function encodeSingleBandUint16Tiff(request: SingleBandTiffRequest): Uint8Array {
  const stripByteSize = request.width * request.height * 2;
  const view = new DataView(new ArrayBuffer(TIFF_HEADER_BYTE_SIZE + TIFF_IFD_BYTE_SIZE + stripByteSize));
  writeLittleEndianTiffHeader(view);
  writeSingleBandImageFileDirectory(view, request);
  fillUniformUint16Strip(view, TIFF_HEADER_BYTE_SIZE + TIFF_IFD_BYTE_SIZE, stripByteSize, request.fillValue);
  return new Uint8Array(view.buffer);
}

function writeLittleEndianTiffHeader(view: DataView): void {
  view.setUint8(0, 0x49);
  view.setUint8(1, 0x49);
  view.setUint16(2, 42, true);
  view.setUint32(4, TIFF_HEADER_BYTE_SIZE, true);
}

function writeSingleBandImageFileDirectory(view: DataView, request: SingleBandTiffRequest): void {
  const stripOffset = TIFF_HEADER_BYTE_SIZE + TIFF_IFD_BYTE_SIZE;
  const entries = buildSingleBandTiffEntries(request.width, request.height, stripOffset);
  view.setUint16(TIFF_HEADER_BYTE_SIZE, entries.length, true);
  entries.forEach((entry, index) => writeImageFileDirectoryEntry(view, TIFF_HEADER_BYTE_SIZE + 2 + index * 12, entry));
  view.setUint32(TIFF_HEADER_BYTE_SIZE + 2 + entries.length * 12, 0, true);
}

interface TiffDirectoryEntry {
  readonly tag: number;
  readonly type: number;
  readonly value: number;
}

function buildSingleBandTiffEntries(
  width: number,
  height: number,
  stripOffset: number,
): TiffDirectoryEntry[] {
  return [
    { tag: 256, type: TIFF_TYPE_SHORT, value: width },
    { tag: 257, type: TIFF_TYPE_SHORT, value: height },
    { tag: 258, type: TIFF_TYPE_SHORT, value: 16 },
    { tag: 259, type: TIFF_TYPE_SHORT, value: 1 },
    { tag: 262, type: TIFF_TYPE_SHORT, value: 1 },
    { tag: 273, type: TIFF_TYPE_LONG, value: stripOffset },
    { tag: 277, type: TIFF_TYPE_SHORT, value: 1 },
    { tag: 278, type: TIFF_TYPE_SHORT, value: height },
    { tag: 279, type: TIFF_TYPE_LONG, value: width * height * 2 },
    { tag: 339, type: TIFF_TYPE_SHORT, value: 1 },
  ];
}

function writeImageFileDirectoryEntry(view: DataView, offset: number, entry: TiffDirectoryEntry): void {
  view.setUint16(offset, entry.tag, true);
  view.setUint16(offset + 2, entry.type, true);
  view.setUint32(offset + 4, 1, true);
  if (entry.type === TIFF_TYPE_SHORT) view.setUint16(offset + 8, entry.value, true);
  else view.setUint32(offset + 8, entry.value, true);
}

function fillUniformUint16Strip(view: DataView, offset: number, byteSize: number, value: number): void {
  for (let index = 0; index < byteSize / 2; index += 1) {
    view.setUint16(offset + index * 2, value, true);
  }
}
