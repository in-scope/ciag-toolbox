import { writeArrayBuffer } from "geotiff";
import { describe, expect, it } from "vitest";

import { loadTiffAsRaster } from "@/lib/image/load-tiff";

describe("loadTiffAsRaster", () => {
  it("decodes a small single-band uint16 TIFF into a raster image with one band", async () => {
    const bytes = buildSyntheticUint16TiffBytes();
    const raster = await loadTiffAsRaster(bytes);
    expect(raster.width).toBe(SYNTHETIC_TIFF_WIDTH);
    expect(raster.height).toBe(SYNTHETIC_TIFF_HEIGHT);
    expect(raster.bitsPerSample).toBe(16);
    expect(raster.sampleFormat).toBe("uint");
    expect(raster.bandCount).toBe(1);
    expect(raster.bandPixels).toHaveLength(1);
    const firstBand = raster.bandPixels[0]!;
    expect(firstBand).toBeInstanceOf(Uint16Array);
    expect(firstBand.length).toBe(SYNTHETIC_TIFF_WIDTH * SYNTHETIC_TIFF_HEIGHT);
  });

  it("rejects bytes that are not a TIFF", async () => {
    const bogus = Uint8Array.of(0, 0, 0, 0);
    await expect(loadTiffAsRaster(bogus)).rejects.toThrow();
  });

  it("skips a smaller second page as an embedded thumbnail and decodes only the primary page", async () => {
    const bytes = buildMultiPageTiffWithSmallerThumbnailPage();
    const raster = await loadTiffAsRaster(bytes);
    expect(raster.width).toBe(MAIN_PAGE_DIMENSION);
    expect(raster.height).toBe(MAIN_PAGE_DIMENSION);
    expect(raster.bandCount).toBe(1);
    expect(raster.bandPixels).toHaveLength(1);
    expect(raster.bandPixels[0]).toBeInstanceOf(Uint16Array);
    expect(raster.bandPixels[0]!.length).toBe(MAIN_PAGE_DIMENSION * MAIN_PAGE_DIMENSION);
  });
});

const SYNTHETIC_TIFF_WIDTH = 8;
const SYNTHETIC_TIFF_HEIGHT = 8;

function buildSyntheticUint16TiffBytes(): Uint8Array {
  const pixels = buildGradientUint16Pixels();
  const buffer = writeArrayBuffer(pixels, buildSyntheticTiffMetadata());
  return new Uint8Array(buffer);
}

function buildGradientUint16Pixels(): Uint16Array {
  const length = SYNTHETIC_TIFF_WIDTH * SYNTHETIC_TIFF_HEIGHT;
  const pixels = new Uint16Array(length);
  for (let i = 0; i < length; i++) {
    pixels[i] = (i * 1024) & 0xffff;
  }
  return pixels;
}

function buildSyntheticTiffMetadata(): Record<string, unknown> {
  return {
    width: SYNTHETIC_TIFF_WIDTH,
    height: SYNTHETIC_TIFF_HEIGHT,
    BitsPerSample: [16],
    SampleFormat: [1],
    SamplesPerPixel: 1,
    PhotometricInterpretation: 1,
    ImageLength: SYNTHETIC_TIFF_HEIGHT,
    ImageWidth: SYNTHETIC_TIFF_WIDTH,
  };
}

const MAIN_PAGE_DIMENSION = 4;
const THUMB_PAGE_DIMENSION = 2;
const TIFF_TYPE_SHORT = 3;
const TIFF_TYPE_LONG = 4;
const TIFF_TAG_IMAGE_WIDTH = 256;
const TIFF_TAG_IMAGE_LENGTH = 257;
const TIFF_TAG_BITS_PER_SAMPLE = 258;
const TIFF_TAG_COMPRESSION = 259;
const TIFF_TAG_PHOTOMETRIC = 262;
const TIFF_TAG_STRIP_OFFSETS = 273;
const TIFF_TAG_SAMPLES_PER_PIXEL = 277;
const TIFF_TAG_ROWS_PER_STRIP = 278;
const TIFF_TAG_STRIP_BYTE_COUNTS = 279;
const TIFF_TAG_SAMPLE_FORMAT = 339;

interface TiffIfdEntry {
  readonly tag: number;
  readonly type: number;
  readonly value: number;
}

function buildMultiPageTiffWithSmallerThumbnailPage(): Uint8Array {
  const mainStripOffset = 134;
  const thumbIfdOffset = 166;
  const thumbStripOffset = 292;
  const totalSize = thumbStripOffset + THUMB_PAGE_DIMENSION * THUMB_PAGE_DIMENSION * 2;
  const view = new DataView(new ArrayBuffer(totalSize));
  writeLittleEndianTiffHeader(view, 8);
  writeIfdAtOffset(view, 8, buildPageEntries(MAIN_PAGE_DIMENSION, mainStripOffset), thumbIfdOffset);
  writeUint16RampAtOffset(view, mainStripOffset, MAIN_PAGE_DIMENSION * MAIN_PAGE_DIMENSION);
  writeIfdAtOffset(view, thumbIfdOffset, buildPageEntries(THUMB_PAGE_DIMENSION, thumbStripOffset), 0);
  writeUint16RampAtOffset(view, thumbStripOffset, THUMB_PAGE_DIMENSION * THUMB_PAGE_DIMENSION);
  return new Uint8Array(view.buffer);
}

function writeLittleEndianTiffHeader(view: DataView, firstIfdOffset: number): void {
  view.setUint8(0, 0x49);
  view.setUint8(1, 0x49);
  view.setUint16(2, 42, true);
  view.setUint32(4, firstIfdOffset, true);
}

function buildPageEntries(dimension: number, stripOffset: number): TiffIfdEntry[] {
  const stripBytes = dimension * dimension * 2;
  return [
    { tag: TIFF_TAG_IMAGE_WIDTH, type: TIFF_TYPE_SHORT, value: dimension },
    { tag: TIFF_TAG_IMAGE_LENGTH, type: TIFF_TYPE_SHORT, value: dimension },
    { tag: TIFF_TAG_BITS_PER_SAMPLE, type: TIFF_TYPE_SHORT, value: 16 },
    { tag: TIFF_TAG_COMPRESSION, type: TIFF_TYPE_SHORT, value: 1 },
    { tag: TIFF_TAG_PHOTOMETRIC, type: TIFF_TYPE_SHORT, value: 1 },
    { tag: TIFF_TAG_STRIP_OFFSETS, type: TIFF_TYPE_LONG, value: stripOffset },
    { tag: TIFF_TAG_SAMPLES_PER_PIXEL, type: TIFF_TYPE_SHORT, value: 1 },
    { tag: TIFF_TAG_ROWS_PER_STRIP, type: TIFF_TYPE_SHORT, value: dimension },
    { tag: TIFF_TAG_STRIP_BYTE_COUNTS, type: TIFF_TYPE_LONG, value: stripBytes },
    { tag: TIFF_TAG_SAMPLE_FORMAT, type: TIFF_TYPE_SHORT, value: 1 },
  ];
}

function writeIfdAtOffset(
  view: DataView,
  ifdOffset: number,
  entries: ReadonlyArray<TiffIfdEntry>,
  nextIfdOffset: number,
): void {
  view.setUint16(ifdOffset, entries.length, true);
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
    writeIfdEntry(view, ifdOffset + 2 + entryIndex * 12, entries[entryIndex]!);
  }
  view.setUint32(ifdOffset + 2 + entries.length * 12, nextIfdOffset, true);
}

function writeIfdEntry(view: DataView, offset: number, entry: TiffIfdEntry): void {
  view.setUint16(offset, entry.tag, true);
  view.setUint16(offset + 2, entry.type, true);
  view.setUint32(offset + 4, 1, true);
  view.setUint32(offset + 8, entry.value, true);
}

function writeUint16RampAtOffset(view: DataView, offset: number, count: number): void {
  for (let i = 0; i < count; i++) {
    view.setUint16(offset + i * 2, (i * 1024) & 0xffff, true);
  }
}
