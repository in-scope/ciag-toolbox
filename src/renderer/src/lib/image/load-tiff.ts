import { fromArrayBuffer } from "geotiff";

import type {
  RasterImage,
  RasterSampleFormat,
  RasterTypedArray,
} from "@/lib/image/raster-image";

type GeoTiffImage = Awaited<
  ReturnType<Awaited<ReturnType<typeof fromArrayBuffer>>["getImage"]>
>;

const TIFF_SAMPLE_FORMAT_UINT = 1;
const TIFF_SAMPLE_FORMAT_INT = 2;
const TIFF_SAMPLE_FORMAT_FLOAT = 3;
const TIFF_SAMPLE_FORMAT_COMPLEX_INT = 5;
const TIFF_SAMPLE_FORMAT_COMPLEX_FLOAT = 6;

export async function loadTiffAsRaster(bytes: Uint8Array): Promise<RasterImage> {
  const arrayBuffer = copyBytesToOwnArrayBuffer(bytes);
  const tiff = await fromArrayBuffer(arrayBuffer);
  const firstImage = await tiff.getImage(0);
  return readRasterFromTiffImage(firstImage);
}

async function readRasterFromTiffImage(image: GeoTiffImage): Promise<RasterImage> {
  const width = image.getWidth();
  const height = image.getHeight();
  const bitsPerSample = readBitsPerSampleOrThrow(image);
  const sampleFormat = readSupportedSampleFormatOrThrow(image, bitsPerSample);
  const bandCount = image.getSamplesPerPixel();
  const pixels = await readFirstBandPixels(image);
  return { pixels, width, height, bitsPerSample, sampleFormat, bandCount };
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

async function readFirstBandPixels(image: GeoTiffImage): Promise<RasterTypedArray> {
  const rasters = (await image.readRasters({ interleave: false })) as ReadonlyArray<RasterTypedArray>;
  const firstBand = rasters[0];
  if (!firstBand) throw new Error("TIFF contained no readable bands");
  return firstBand;
}

function copyBytesToOwnArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
