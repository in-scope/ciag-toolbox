import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A throwaway single-band 8-bit (uint8) TIFF written under os.tmpdir. No committed
// fixture is an 8-bit raster (the PNGs load as image-bitmap with no transformable
// raster), so the Invert "out = 255 - v" / its-own-inverse oracle (CT-141, manual 8.1)
// needs a real uint8 stack. The pixel value at (x, y) follows a documented gradient so
// the spec asserts EXACT 255 - v on distinct values. The encoder mirrors the single-page
// classic TIFF in generate-fixtures.mjs but with 8-bit samples.

const TIFF_HEADER_BYTE_SIZE = 8;
const TIFF_ENTRY_COUNT = 10;
const TIFF_IFD_BYTE_SIZE = 2 + TIFF_ENTRY_COUNT * 12 + 4;
const TIFF_TYPE_SHORT = 3;
const TIFF_TYPE_LONG = 4;

export const UINT8_FIXTURE_SIDE = 4;
const UINT8_FIXTURE_BASE_VALUE = 10;
const UINT8_FIXTURE_VALUE_STEP = 15;

export function uint8FixtureValueAt(imageX: number, imageY: number): number {
  const index = imageY * UINT8_FIXTURE_SIDE + imageX;
  return UINT8_FIXTURE_BASE_VALUE + index * UINT8_FIXTURE_VALUE_STEP;
}

export async function writeTemporarySingleBandUint8Tiff(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "msi-e2e-uint8-"));
  const filePath = join(directory, "bounded-uint8.tif");
  await writeFile(filePath, encodeSingleBandUint8Tiff());
  return filePath;
}

function encodeSingleBandUint8Tiff(): Uint8Array {
  const pixelCount = UINT8_FIXTURE_SIDE * UINT8_FIXTURE_SIDE;
  const view = new DataView(new ArrayBuffer(TIFF_HEADER_BYTE_SIZE + TIFF_IFD_BYTE_SIZE + pixelCount));
  writeLittleEndianTiffHeader(view);
  writeSingleBandImageFileDirectory(view);
  fillGradientUint8Strip(view, TIFF_HEADER_BYTE_SIZE + TIFF_IFD_BYTE_SIZE);
  return new Uint8Array(view.buffer);
}

function writeLittleEndianTiffHeader(view: DataView): void {
  view.setUint8(0, 0x49);
  view.setUint8(1, 0x49);
  view.setUint16(2, 42, true);
  view.setUint32(4, TIFF_HEADER_BYTE_SIZE, true);
}

function writeSingleBandImageFileDirectory(view: DataView): void {
  const stripOffset = TIFF_HEADER_BYTE_SIZE + TIFF_IFD_BYTE_SIZE;
  const entries = buildSingleBandUint8TiffEntries(stripOffset);
  view.setUint16(TIFF_HEADER_BYTE_SIZE, entries.length, true);
  entries.forEach((entry, index) => writeImageFileDirectoryEntry(view, TIFF_HEADER_BYTE_SIZE + 2 + index * 12, entry));
  view.setUint32(TIFF_HEADER_BYTE_SIZE + 2 + entries.length * 12, 0, true);
}

interface TiffDirectoryEntry {
  readonly tag: number;
  readonly type: number;
  readonly value: number;
}

function buildSingleBandUint8TiffEntries(stripOffset: number): TiffDirectoryEntry[] {
  const pixelCount = UINT8_FIXTURE_SIDE * UINT8_FIXTURE_SIDE;
  return [
    { tag: 256, type: TIFF_TYPE_SHORT, value: UINT8_FIXTURE_SIDE },
    { tag: 257, type: TIFF_TYPE_SHORT, value: UINT8_FIXTURE_SIDE },
    { tag: 258, type: TIFF_TYPE_SHORT, value: 8 },
    { tag: 259, type: TIFF_TYPE_SHORT, value: 1 },
    { tag: 262, type: TIFF_TYPE_SHORT, value: 1 },
    { tag: 273, type: TIFF_TYPE_LONG, value: stripOffset },
    { tag: 277, type: TIFF_TYPE_SHORT, value: 1 },
    { tag: 278, type: TIFF_TYPE_SHORT, value: UINT8_FIXTURE_SIDE },
    { tag: 279, type: TIFF_TYPE_LONG, value: pixelCount },
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

function fillGradientUint8Strip(view: DataView, offset: number): void {
  for (let imageY = 0; imageY < UINT8_FIXTURE_SIDE; imageY += 1) {
    for (let imageX = 0; imageX < UINT8_FIXTURE_SIDE; imageX += 1) {
      view.setUint8(offset + imageY * UINT8_FIXTURE_SIDE + imageX, uint8FixtureValueAt(imageX, imageY));
    }
  }
}
