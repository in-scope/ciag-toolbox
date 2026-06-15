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

  it("loads an RGB-photometric single-page TIFF as a true-colour three-band raster", async () => {
    const bytes = buildSyntheticRgbTiffBytes();
    const raster = await loadTiffAsRaster(bytes);
    expect(raster.bandCount).toBe(3);
    expect(raster.colorInterpretation).toBe("rgb");
    expect(raster.bandPixels[0]![0]).toBe(RGB_FIRST_PIXEL_RED);
    expect(raster.bandPixels[1]![0]).toBe(RGB_FIRST_PIXEL_GREEN);
    expect(raster.bandPixels[2]![0]).toBe(RGB_FIRST_PIXEL_BLUE);
  });

  it("leaves a three-page BlackIsZero science stack as a grayscale stack with no rgb tag", async () => {
    const bytes = buildThreePageScienceStackTiffBytes();
    const raster = await loadTiffAsRaster(bytes);
    expect(raster.bandCount).toBe(3);
    expect(raster.colorInterpretation).toBeUndefined();
  });
});

const RGB_TIFF_DIMENSION = 2;
const RGB_FIRST_PIXEL_RED = 10;
const RGB_FIRST_PIXEL_GREEN = 50;
const RGB_FIRST_PIXEL_BLUE = 90;

function buildSyntheticRgbTiffBytes(): Uint8Array {
  const buffer = writeArrayBuffer(buildInterleavedRgbPixels(), buildRgbTiffMetadata());
  return new Uint8Array(buffer);
}

function buildInterleavedRgbPixels(): Uint8Array {
  const pixelCount = RGB_TIFF_DIMENSION * RGB_TIFF_DIMENSION;
  const interleaved = new Uint8Array(pixelCount * 3);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    interleaved[pixelIndex * 3] = RGB_FIRST_PIXEL_RED + pixelIndex;
    interleaved[pixelIndex * 3 + 1] = RGB_FIRST_PIXEL_GREEN + pixelIndex;
    interleaved[pixelIndex * 3 + 2] = RGB_FIRST_PIXEL_BLUE + pixelIndex;
  }
  return interleaved;
}

function buildRgbTiffMetadata(): Record<string, unknown> {
  return {
    width: RGB_TIFF_DIMENSION,
    height: RGB_TIFF_DIMENSION,
    BitsPerSample: [8, 8, 8],
    SampleFormat: [1, 1, 1],
    SamplesPerPixel: 3,
    PhotometricInterpretation: 2,
    ImageLength: RGB_TIFF_DIMENSION,
    ImageWidth: RGB_TIFF_DIMENSION,
  };
}

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

const SCIENCE_STACK_DIMENSION = 4;
const SCIENCE_STACK_PAGE_PIXELS = SCIENCE_STACK_DIMENSION * SCIENCE_STACK_DIMENSION;
const SCIENCE_STACK_PAGE_OFFSETS: ReadonlyArray<{ ifd: number; strip: number }> = [
  { ifd: 8, strip: 134 },
  { ifd: 166, strip: 292 },
  { ifd: 324, strip: 450 },
];

function buildThreePageScienceStackTiffBytes(): Uint8Array {
  const totalSize = lastSciencePageOffsets().strip + SCIENCE_STACK_PAGE_PIXELS * 2;
  const view = new DataView(new ArrayBuffer(totalSize));
  writeLittleEndianTiffHeader(view, SCIENCE_STACK_PAGE_OFFSETS[0]!.ifd);
  SCIENCE_STACK_PAGE_OFFSETS.forEach((page, pageIndex) => writeSciencePage(view, page, pageIndex));
  return new Uint8Array(view.buffer);
}

function writeSciencePage(
  view: DataView,
  page: { ifd: number; strip: number },
  pageIndex: number,
): void {
  const entries = buildPageEntries(SCIENCE_STACK_DIMENSION, page.strip);
  writeIfdAtOffset(view, page.ifd, entries, nextScienceIfdOffset(pageIndex));
  writeUint16RampAtOffset(view, page.strip, SCIENCE_STACK_PAGE_PIXELS);
}

function nextScienceIfdOffset(pageIndex: number): number {
  return SCIENCE_STACK_PAGE_OFFSETS[pageIndex + 1]?.ifd ?? 0;
}

function lastSciencePageOffsets(): { ifd: number; strip: number } {
  return SCIENCE_STACK_PAGE_OFFSETS[SCIENCE_STACK_PAGE_OFFSETS.length - 1]!;
}
