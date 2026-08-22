import { fromArrayBuffer } from "geotiff";

import {
  reportCompletedUnitAndYieldSoProgressCanPaint,
  reportMultiUnitWorkStarting,
  type UnitProgressCallback,
} from "@/lib/image/unit-progress";
import type {
  RasterImage,
  RasterSampleFormat,
  RasterTypedArray,
} from "@/lib/image/raster-image";

type GeoTiff = Awaited<ReturnType<typeof fromArrayBuffer>>;
type GeoTiffImage = Awaited<ReturnType<GeoTiff["getImage"]>>;

const TIFF_SAMPLE_FORMAT_UINT = 1;
const TIFF_SAMPLE_FORMAT_INT = 2;
const TIFF_SAMPLE_FORMAT_FLOAT = 3;
const TIFF_SAMPLE_FORMAT_COMPLEX_INT = 5;
const TIFF_SAMPLE_FORMAT_COMPLEX_FLOAT = 6;

// CT-160: a single-page TIFF whose PhotometricInterpretation is RGB (262 == 2) with three
// samples per pixel is a true-colour photo, not a science stack. We load its three samples
// as R/G/B bands tagged "rgb" so the viewport reopens it as an RGB composite, instead of
// reading only the first sample as one grey band.
// CT-288 broadens the colour detection past that exact shape: an RGBA file (photometric
// RGB with an extra-samples alpha, alpha dropped), a palette-colour file (colormap
// expanded to 8-bit RGB), and a 3-sample file whose writer omitted the photometric tag
// all load as 3-band rgb rasters. Multi-page BlackIsZero science stacks are untouched;
// YCbCr/JPEG-compressed TIFFs stay out of scope.
const TIFF_PHOTOMETRIC_RGB = 2;
const TIFF_PHOTOMETRIC_PALETTE = 3;
const TRUE_COLOUR_BAND_COUNT = 3;
const PALETTE_CHANNEL_COUNT = 3;
const PALETTE_EXPANDED_BITS_PER_SAMPLE = 8;
// TIFF colormap entries are 16-bit per channel; the top byte is the 8-bit colour.
const PALETTE_COLOR_MAP_TO_BYTE_SHIFT = 8;
const RGB_BAND_LABELS: ReadonlyArray<string> = ["Red", "Green", "Blue"];
const RGB_BAND_ORIGINAL_NUMBERS: ReadonlyArray<number> = [1, 2, 3];

interface TiffPageHeader {
  readonly width: number;
  readonly height: number;
  readonly bitsPerSample: number;
  readonly sampleFormat: RasterSampleFormat;
  readonly description: string | null;
}

export async function loadTiffAsRaster(
  bytes: Uint8Array,
  onDecodeProgress?: UnitProgressCallback,
): Promise<RasterImage> {
  const arrayBuffer = extractArrayBufferWithoutCopyingWhenPossible(bytes);
  const tiff = await fromArrayBuffer(arrayBuffer);
  const pageCount = await tiff.getImageCount();
  const firstPage = await tiff.getImage(0);
  const firstHeader = readTiffPageHeader(firstPage);
  if (pageIsTrueColourRgb(firstPage)) {
    return readSinglePageRgbCompositeRaster(firstPage, firstHeader);
  }
  const paletteColorMap = await readPaletteColorMapOrNull(firstPage);
  if (paletteColorMap) {
    return readSinglePagePaletteRgbRaster(firstPage, firstHeader, paletteColorMap);
  }
  return readRasterAcrossAllPages(tiff, firstHeader, pageCount, onDecodeProgress);
}

function pageIsTrueColourRgb(image: GeoTiffImage): boolean {
  const photometric = readPhotometricInterpretationOrNull(image);
  if (photometric === TIFF_PHOTOMETRIC_RGB) {
    return image.getSamplesPerPixel() >= TRUE_COLOUR_BAND_COUNT;
  }
  return photometric === null && image.getSamplesPerPixel() === TRUE_COLOUR_BAND_COUNT;
}

interface TiffFileDirectoryAccess {
  getValue(tag: string): unknown;
  loadValue(tag: string): Promise<unknown>;
}

function readFileDirectoryOrNull(image: GeoTiffImage): TiffFileDirectoryAccess | null {
  const fileDirectory = (image as unknown as {
    fileDirectory?: TiffFileDirectoryAccess;
  }).fileDirectory;
  return fileDirectory ?? null;
}

function readPhotometricInterpretationOrNull(image: GeoTiffImage): number | null {
  const value = readFileDirectoryOrNull(image)?.getValue("PhotometricInterpretation");
  return typeof value === "number" ? value : null;
}

async function readPaletteColorMapOrNull(
  image: GeoTiffImage,
): Promise<ArrayLike<number> | null> {
  if (readPhotometricInterpretationOrNull(image) !== TIFF_PHOTOMETRIC_PALETTE) return null;
  const value = await readFileDirectoryOrNull(image)?.loadValue("ColorMap");
  return colorMapHoldsAllThreeChannels(value) ? value : null;
}

function colorMapHoldsAllThreeChannels(value: unknown): value is ArrayLike<number> {
  if (!isNumericArrayLike(value)) return false;
  return value.length >= PALETTE_CHANNEL_COUNT && value.length % PALETTE_CHANNEL_COUNT === 0;
}

function isNumericArrayLike(value: unknown): value is ArrayLike<number> {
  if (Array.isArray(value)) return true;
  return ArrayBuffer.isView(value) && !(value instanceof DataView);
}

async function readSinglePageRgbCompositeRaster(
  image: GeoTiffImage,
  header: TiffPageHeader,
): Promise<RasterImage> {
  return buildTrueColourRgbRaster(header, await readAllBandPixels(image));
}

function buildTrueColourRgbRaster(
  header: TiffPageHeader,
  bandPixels: ReadonlyArray<RasterTypedArray>,
): RasterImage {
  return {
    bandPixels,
    width: header.width,
    height: header.height,
    bitsPerSample: header.bitsPerSample,
    sampleFormat: header.sampleFormat,
    bandCount: bandPixels.length,
    bandLabels: RGB_BAND_LABELS,
    bandOriginalNumbers: RGB_BAND_ORIGINAL_NUMBERS,
    colorInterpretation: "rgb",
  };
}

async function readAllBandPixels(image: GeoTiffImage): Promise<RasterTypedArray[]> {
  const rasters = (await image.readRasters({ interleave: false })) as ReadonlyArray<RasterTypedArray>;
  if (rasters.length === 0) throw new Error("TIFF contained no readable bands");
  // Keeping the first three planes drops any extra samples (e.g. an RGBA alpha, CT-288).
  return rasters.slice(0, TRUE_COLOUR_BAND_COUNT) as RasterTypedArray[];
}

async function readSinglePagePaletteRgbRaster(
  image: GeoTiffImage,
  header: TiffPageHeader,
  colorMap: ArrayLike<number>,
): Promise<RasterImage> {
  const paletteIndexes = await readFirstBandPixels(image);
  return buildTrueColourRgbRaster(
    { ...header, bitsPerSample: PALETTE_EXPANDED_BITS_PER_SAMPLE, sampleFormat: "uint" },
    expandPaletteIndexesToRgbBands(paletteIndexes, colorMap),
  );
}

function expandPaletteIndexesToRgbBands(
  paletteIndexes: RasterTypedArray,
  colorMap: ArrayLike<number>,
): RasterTypedArray[] {
  const entryCount = colorMap.length / PALETTE_CHANNEL_COUNT;
  return [0, 1, 2].map((channel) =>
    expandOnePaletteChannelToBand(paletteIndexes, colorMap, channel * entryCount, entryCount),
  );
}

function expandOnePaletteChannelToBand(
  paletteIndexes: RasterTypedArray,
  colorMap: ArrayLike<number>,
  channelOffset: number,
  entryCount: number,
): Uint8Array {
  const band = new Uint8Array(paletteIndexes.length);
  for (let pixelIndex = 0; pixelIndex < paletteIndexes.length; pixelIndex += 1) {
    const paletteIndex = Math.min(paletteIndexes[pixelIndex]!, entryCount - 1);
    band[pixelIndex] = colorMap[channelOffset + paletteIndex]! >> PALETTE_COLOR_MAP_TO_BYTE_SHIFT;
  }
  return band;
}

async function readRasterAcrossAllPages(
  tiff: GeoTiff,
  firstHeader: TiffPageHeader,
  pageCount: number,
  onDecodeProgress?: UnitProgressCallback,
): Promise<RasterImage> {
  const bandPixels: RasterTypedArray[] = [];
  const bandLabels: string[] = [];
  reportMultiUnitWorkStarting(onDecodeProgress, pageCount);
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    await readSingleTiffPageIntoBands(tiff, pageIndex, firstHeader, bandPixels, bandLabels);
    await reportCompletedUnitAndYieldSoProgressCanPaint(onDecodeProgress, pageIndex + 1, pageCount);
  }
  return buildRasterImageFromBands(firstHeader, bandPixels, bandLabels);
}

async function readSingleTiffPageIntoBands(
  tiff: GeoTiff,
  pageIndex: number,
  firstHeader: TiffPageHeader,
  bandPixels: RasterTypedArray[],
  bandLabels: string[],
): Promise<void> {
  const page = await tiff.getImage(pageIndex);
  const header = readTiffPageHeader(page);
  if (pageIsEmbeddedThumbnail(header, firstHeader)) return;
  bandPixels.push(await readFirstBandPixels(page));
  bandLabels.push(header.description ?? "");
}

function buildRasterImageFromBands(
  header: TiffPageHeader,
  bandPixels: RasterTypedArray[],
  bandLabels: string[],
): RasterImage {
  return {
    bandPixels,
    width: header.width,
    height: header.height,
    bitsPerSample: header.bitsPerSample,
    sampleFormat: header.sampleFormat,
    bandCount: bandPixels.length,
    bandLabels: anyLabelHasText(bandLabels) ? bandLabels : undefined,
  };
}

function anyLabelHasText(labels: ReadonlyArray<string>): boolean {
  return labels.some((label) => label.length > 0);
}

function readTiffPageHeader(image: GeoTiffImage): TiffPageHeader {
  const bitsPerSample = readBitsPerSampleOrThrow(image);
  return {
    width: image.getWidth(),
    height: image.getHeight(),
    bitsPerSample,
    sampleFormat: readSupportedSampleFormatOrThrow(image, bitsPerSample),
    description: readImageDescriptionOrNull(image),
  };
}

function pageIsEmbeddedThumbnail(
  page: TiffPageHeader,
  firstPage: TiffPageHeader,
): boolean {
  return page.width !== firstPage.width
    || page.height !== firstPage.height
    || page.bitsPerSample !== firstPage.bitsPerSample
    || page.sampleFormat !== firstPage.sampleFormat;
}

function readBitsPerSampleOrThrow(image: GeoTiffImage): number {
  const bitsPerSample = image.getBitsPerSample();
  if (!bitsPerSample) throw new Error("TIFF reports zero bits per sample");
  return bitsPerSample;
}

function readSupportedSampleFormatOrThrow(
  image: GeoTiffImage,
  bitsPerSample: number,
): RasterSampleFormat {
  const tiffSampleFormat = readTiffSampleFormatTag(image);
  rejectUnsupportedSampleFormat(tiffSampleFormat, bitsPerSample);
  return convertTiffSampleFormatTagToRasterSampleFormat(tiffSampleFormat);
}

function readTiffSampleFormatTag(image: GeoTiffImage): number {
  const value = image.getSampleFormat();
  return Number.isFinite(value) ? value : TIFF_SAMPLE_FORMAT_UINT;
}

function rejectUnsupportedSampleFormat(
  tiffSampleFormat: number,
  bitsPerSample: number,
): void {
  rejectComplexSampleFormat(tiffSampleFormat);
  if (tiffSampleFormat === TIFF_SAMPLE_FORMAT_FLOAT) {
    rejectDoublePrecisionFloat(bitsPerSample);
  }
}

function rejectComplexSampleFormat(tiffSampleFormat: number): void {
  if (tiffSampleFormat === TIFF_SAMPLE_FORMAT_COMPLEX_INT) {
    throw new Error("Complex integer TIFFs are not supported");
  }
  if (tiffSampleFormat === TIFF_SAMPLE_FORMAT_COMPLEX_FLOAT) {
    throw new Error("Complex floating point TIFFs are not supported");
  }
}

function rejectDoublePrecisionFloat(bitsPerSample: number): void {
  if (bitsPerSample === 64) {
    throw new Error("64-bit double precision TIFFs are not supported");
  }
}

function convertTiffSampleFormatTagToRasterSampleFormat(
  tiffSampleFormat: number,
): RasterSampleFormat {
  if (tiffSampleFormat === TIFF_SAMPLE_FORMAT_FLOAT) return "float";
  if (tiffSampleFormat === TIFF_SAMPLE_FORMAT_INT) return "int";
  return "uint";
}

function readImageDescriptionOrNull(image: GeoTiffImage): string | null {
  const fileDirectory = (image as unknown as { fileDirectory?: Record<string, unknown> }).fileDirectory;
  if (!fileDirectory) return null;
  const value = readPreferredLabelTag(fileDirectory);
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readPreferredLabelTag(fileDirectory: Record<string, unknown>): unknown {
  return fileDirectory.PageName ?? fileDirectory.ImageDescription ?? null;
}

async function readFirstBandPixels(image: GeoTiffImage): Promise<RasterTypedArray> {
  const rasters = (await image.readRasters({ interleave: false })) as ReadonlyArray<RasterTypedArray>;
  const firstBand = rasters[0];
  if (!firstBand) throw new Error("TIFF contained no readable bands");
  return firstBand;
}

function extractArrayBufferWithoutCopyingWhenPossible(bytes: Uint8Array): ArrayBuffer {
  const buffer = bytes.buffer as ArrayBuffer;
  if (bytes.byteOffset === 0 && bytes.byteLength === buffer.byteLength) {
    return buffer;
  }
  return buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
