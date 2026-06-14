import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A throwaway multi-band float32 (IEEE float, SampleFormat 3) TIFF written under
// os.tmpdir. Every committed fixture is an integer raster, but the chart-axis
// superscript polish (CT-156 / CT-100) only reaches the histogram value axis on a
// FLOAT band (integer histograms span the fixed data-type container range, whose
// endpoints are plain integers). This builds a float stack whose band min/max are a
// tiny (4e-7) and a huge (6e+4) magnitude, so the formatted axis labels land in
// scientific notation. The encoder mirrors the multi-page classic TIFF in
// temporary-multi-band-tiff-fixture.ts but stores 32-bit IEEE floats per sample.

const TIFF_HEADER_BYTE_SIZE = 8;
const TIFF_ENTRY_COUNT = 10;
const TIFF_IFD_BYTE_SIZE = 2 + TIFF_ENTRY_COUNT * 12 + 4;
const TIFF_TYPE_SHORT = 3;
const TIFF_TYPE_LONG = 4;
const FLOAT32_BYTES_PER_SAMPLE = 4;
const TIFF_SAMPLE_FORMAT_IEEE_FLOAT = 3;

export interface MultiBandFloat32TiffRequest {
  readonly width: number;
  readonly height: number;
  readonly bands: ReadonlyArray<ReadonlyArray<number>>;
}

export async function writeTemporaryMultiBandFloat32Tiff(
  request: MultiBandFloat32TiffRequest,
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "msi-e2e-float32-"));
  const filePath = join(directory, `float32-${request.bands.length}band.tif`);
  await writeFile(filePath, encodeMultiBandFloat32Tiff(request));
  return filePath;
}

function encodeMultiBandFloat32Tiff(request: MultiBandFloat32TiffRequest): Uint8Array {
  const stripByteSize = request.width * request.height * FLOAT32_BYTES_PER_SAMPLE;
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
  request: MultiBandFloat32TiffRequest,
  pageIndex: number,
  pageBlockSize: number,
  band: ReadonlyArray<number>,
): void {
  const ifdOffset = TIFF_HEADER_BYTE_SIZE + pageIndex * pageBlockSize;
  const stripOffset = ifdOffset + TIFF_IFD_BYTE_SIZE;
  const isLastPage = pageIndex === request.bands.length - 1;
  const nextIfdOffset = isLastPage ? 0 : ifdOffset + pageBlockSize;
  writeImageFileDirectory(view, ifdOffset, request, stripOffset, nextIfdOffset);
  writeFloat32Strip(view, stripOffset, band);
}

function writeImageFileDirectory(
  view: DataView,
  ifdOffset: number,
  request: MultiBandFloat32TiffRequest,
  stripOffset: number,
  nextIfdOffset: number,
): void {
  const entries = buildFloat32BandTiffEntries(request.width, request.height, stripOffset);
  view.setUint16(ifdOffset, entries.length, true);
  entries.forEach((entry, index) => writeImageFileDirectoryEntry(view, ifdOffset + 2 + index * 12, entry));
  view.setUint32(ifdOffset + 2 + entries.length * 12, nextIfdOffset, true);
}

interface TiffDirectoryEntry {
  readonly tag: number;
  readonly type: number;
  readonly value: number;
}

function buildFloat32BandTiffEntries(
  width: number,
  height: number,
  stripOffset: number,
): TiffDirectoryEntry[] {
  return [
    { tag: 256, type: TIFF_TYPE_SHORT, value: width },
    { tag: 257, type: TIFF_TYPE_SHORT, value: height },
    { tag: 258, type: TIFF_TYPE_SHORT, value: 32 },
    { tag: 259, type: TIFF_TYPE_SHORT, value: 1 },
    { tag: 262, type: TIFF_TYPE_SHORT, value: 1 },
    { tag: 273, type: TIFF_TYPE_LONG, value: stripOffset },
    { tag: 277, type: TIFF_TYPE_SHORT, value: 1 },
    { tag: 278, type: TIFF_TYPE_SHORT, value: height },
    { tag: 279, type: TIFF_TYPE_LONG, value: width * height * FLOAT32_BYTES_PER_SAMPLE },
    { tag: 339, type: TIFF_TYPE_SHORT, value: TIFF_SAMPLE_FORMAT_IEEE_FLOAT },
  ];
}

function writeImageFileDirectoryEntry(view: DataView, offset: number, entry: TiffDirectoryEntry): void {
  view.setUint16(offset, entry.tag, true);
  view.setUint16(offset + 2, entry.type, true);
  view.setUint32(offset + 4, 1, true);
  if (entry.type === TIFF_TYPE_SHORT) view.setUint16(offset + 8, entry.value, true);
  else view.setUint32(offset + 8, entry.value, true);
}

function writeFloat32Strip(view: DataView, offset: number, band: ReadonlyArray<number>): void {
  band.forEach((value, index) => view.setFloat32(offset + index * FLOAT32_BYTES_PER_SAMPLE, value, true));
}
