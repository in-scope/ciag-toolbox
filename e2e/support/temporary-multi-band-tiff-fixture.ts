import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A throwaway multi-band uint16 TIFF (one classic IFD/strip per band) written
// under os.tmpdir. The committed multiband-12bit.tif has three identically
// shaped gradient bands, so every false-color band assignment stretches to the
// same preview bytes and a band swap is invisible (CT-145). This builds a stack
// whose bands carry DISTINCT spatial patterns, so swapping band-to-channel
// assignments visibly changes the composite. The encoder mirrors the multi-page
// classic TIFF in e2e/fixtures/generate-fixtures.mjs.

const TIFF_HEADER_BYTE_SIZE = 8;
const TIFF_ENTRY_COUNT = 10;
const TIFF_IFD_BYTE_SIZE = 2 + TIFF_ENTRY_COUNT * 12 + 4;
const TIFF_TYPE_SHORT = 3;
const TIFF_TYPE_LONG = 4;

export interface MultiBandTiffRequest {
  readonly width: number;
  readonly height: number;
  readonly bands: ReadonlyArray<ReadonlyArray<number>>;
}

export async function writeTemporaryMultiBandUint16Tiff(
  request: MultiBandTiffRequest,
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "msi-e2e-multiband-"));
  const filePath = join(directory, `multiband-${request.bands.length}band.tif`);
  await writeFile(filePath, encodeMultiBandUint16Tiff(request));
  return filePath;
}

function encodeMultiBandUint16Tiff(request: MultiBandTiffRequest): Uint8Array {
  const stripByteSize = request.width * request.height * 2;
  const pageBlockSize = TIFF_IFD_BYTE_SIZE + stripByteSize;
  const view = new DataView(new ArrayBuffer(TIFF_HEADER_BYTE_SIZE + request.bands.length * pageBlockSize));
  writeLittleEndianTiffHeader(view);
  request.bands.forEach((band, pageIndex) =>
    writeBandPage(view, request, pageIndex, pageBlockSize, band),
  );
  return new Uint8Array(view.buffer);
}

function writeLittleEndianTiffHeader(view: DataView): void {
  view.setUint8(0, 0x49);
  view.setUint8(1, 0x49);
  view.setUint16(2, 42, true);
  view.setUint32(4, TIFF_HEADER_BYTE_SIZE, true);
}

function writeBandPage(
  view: DataView,
  request: MultiBandTiffRequest,
  pageIndex: number,
  pageBlockSize: number,
  band: ReadonlyArray<number>,
): void {
  const ifdOffset = TIFF_HEADER_BYTE_SIZE + pageIndex * pageBlockSize;
  const stripOffset = ifdOffset + TIFF_IFD_BYTE_SIZE;
  const isLastPage = pageIndex === request.bands.length - 1;
  const nextIfdOffset = isLastPage ? 0 : ifdOffset + pageBlockSize;
  writeImageFileDirectory(view, ifdOffset, request, stripOffset, nextIfdOffset);
  writeUint16Strip(view, stripOffset, band);
}

function writeImageFileDirectory(
  view: DataView,
  ifdOffset: number,
  request: MultiBandTiffRequest,
  stripOffset: number,
  nextIfdOffset: number,
): void {
  const entries = buildBandTiffEntries(request.width, request.height, stripOffset);
  view.setUint16(ifdOffset, entries.length, true);
  entries.forEach((entry, index) => writeImageFileDirectoryEntry(view, ifdOffset + 2 + index * 12, entry));
  view.setUint32(ifdOffset + 2 + entries.length * 12, nextIfdOffset, true);
}

interface TiffDirectoryEntry {
  readonly tag: number;
  readonly type: number;
  readonly value: number;
}

function buildBandTiffEntries(width: number, height: number, stripOffset: number): TiffDirectoryEntry[] {
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

function writeUint16Strip(view: DataView, offset: number, band: ReadonlyArray<number>): void {
  band.forEach((value, index) => view.setUint16(offset + index * 2, value, true));
}
