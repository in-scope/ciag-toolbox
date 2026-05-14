import type {
  RasterImage,
  RasterSampleFormat,
  RasterTypedArray,
} from "@/lib/image/raster-image";

const RAW_OUTPUT_BITS_PER_SAMPLE = 16;
const RAW_OUTPUT_COLOR_SPACE_SRGB = 1;
const RAW_RGB_BAND_COUNT = 3;
const RAW_BAND_LABELS: ReadonlyArray<string> = ["Red", "Green", "Blue"];

interface LibRawInstance {
  open: (bytes: Uint8Array, settings: LibRawSettings) => Promise<unknown>;
  metadata: (fullOutput?: boolean) => Promise<LibRawMetadata>;
  imageData: () => Promise<LibRawImageDataReturn>;
}

type LibRawSettings = Record<string, unknown>;

interface LibRawMetadata {
  readonly width?: number;
  readonly height?: number;
  readonly bits?: number;
  readonly colors?: number;
  readonly camera_make?: string;
  readonly camera_model?: string;
}

type LibRawImageDataReturn =
  | Uint8Array
  | Uint16Array
  | LibRawProcessedImage;

interface LibRawProcessedImage {
  readonly width: number;
  readonly height: number;
  readonly bits: number;
  readonly colors: number;
  readonly data: Uint8Array | Uint16Array;
}

let cachedLibRawConstructorPromise: Promise<LibRawConstructor> | null = null;

type LibRawConstructor = new () => LibRawInstance;

export async function loadRawAsRaster(bytes: Uint8Array): Promise<RasterImage> {
  const LibRaw = await loadLibRawConstructorOnce();
  const instance = new LibRaw();
  await openRawBytesIntoLibRawOrThrow(instance, bytes);
  const metadata = await instance.metadata();
  const decoded = await instance.imageData();
  return buildRasterFromLibRawDecodedImage(metadata, decoded);
}

async function loadLibRawConstructorOnce(): Promise<LibRawConstructor> {
  if (!cachedLibRawConstructorPromise) {
    cachedLibRawConstructorPromise = importLibRawConstructorDynamically();
  }
  return cachedLibRawConstructorPromise;
}

async function importLibRawConstructorDynamically(): Promise<LibRawConstructor> {
  const moduleNamespace = await import("libraw-wasm");
  return moduleNamespace.default as LibRawConstructor;
}

async function openRawBytesIntoLibRawOrThrow(
  instance: LibRawInstance,
  bytes: Uint8Array,
): Promise<void> {
  try {
    await instance.open(bytes, buildLibRawOpenSettings());
  } catch (error) {
    throw new Error(buildLibRawOpenFailureMessage(error));
  }
}

function buildLibRawOpenSettings(): LibRawSettings {
  return {
    useCameraWb: true,
    outputBps: RAW_OUTPUT_BITS_PER_SAMPLE,
    outputColor: RAW_OUTPUT_COLOR_SPACE_SRGB,
  };
}

function buildLibRawOpenFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `Could not decode raw camera file (libraw): ${detail}`;
}

function buildRasterFromLibRawDecodedImage(
  metadata: LibRawMetadata,
  decoded: LibRawImageDataReturn,
): RasterImage {
  const layout = resolveLibRawDecodedLayoutOrThrow(metadata, decoded);
  rejectNonRgbDecodedLayout(layout);
  const bandPixels = splitInterleavedRgbPixelsIntoBands(layout);
  return buildRasterImageFromLayoutAndBands(layout, bandPixels);
}

interface LibRawDecodedLayout {
  readonly width: number;
  readonly height: number;
  readonly bitsPerSample: number;
  readonly colors: number;
  readonly pixels: Uint8Array | Uint16Array;
}

function resolveLibRawDecodedLayoutOrThrow(
  metadata: LibRawMetadata,
  decoded: LibRawImageDataReturn,
): LibRawDecodedLayout {
  if (isLibRawProcessedImageObject(decoded)) {
    return resolveLayoutFromProcessedImageObject(decoded);
  }
  return resolveLayoutFromTypedArrayAndMetadata(decoded, metadata);
}

function isLibRawProcessedImageObject(
  decoded: LibRawImageDataReturn,
): decoded is LibRawProcessedImage {
  return !ArrayBuffer.isView(decoded);
}

function resolveLayoutFromProcessedImageObject(
  decoded: LibRawProcessedImage,
): LibRawDecodedLayout {
  return {
    width: decoded.width,
    height: decoded.height,
    bitsPerSample: decoded.bits,
    colors: decoded.colors,
    pixels: decoded.data,
  };
}

function resolveLayoutFromTypedArrayAndMetadata(
  pixels: Uint8Array | Uint16Array,
  metadata: LibRawMetadata,
): LibRawDecodedLayout {
  const width = readPositiveMetadataFieldOrThrow(metadata.width, "width");
  const height = readPositiveMetadataFieldOrThrow(metadata.height, "height");
  const bitsPerSample = pixels instanceof Uint16Array ? 16 : 8;
  const colors = inferColorCountFromPixelStrideOrThrow(pixels, width, height);
  return { width, height, bitsPerSample, colors, pixels };
}

function readPositiveMetadataFieldOrThrow(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Raw camera metadata is missing a positive ${fieldName}`);
  }
  return value;
}

function inferColorCountFromPixelStrideOrThrow(
  pixels: Uint8Array | Uint16Array,
  width: number,
  height: number,
): number {
  const totalSamples = pixels.length;
  const samplesPerPixel = totalSamples / (width * height);
  if (!Number.isInteger(samplesPerPixel) || samplesPerPixel <= 0) {
    throw new Error("Raw camera image data length does not match width * height");
  }
  return samplesPerPixel;
}

function rejectNonRgbDecodedLayout(layout: LibRawDecodedLayout): void {
  if (layout.colors !== RAW_RGB_BAND_COUNT) {
    throw new Error(
      `Raw camera output reported ${layout.colors} colour channels; only 3-channel RGB is supported`,
    );
  }
}

function splitInterleavedRgbPixelsIntoBands(
  layout: LibRawDecodedLayout,
): ReadonlyArray<RasterTypedArray> {
  const pixelCount = layout.width * layout.height;
  const bands = allocateRgbBandsForPixelCount(layout.pixels, pixelCount);
  fillBandsFromInterleavedSource(bands, layout.pixels, pixelCount);
  return bands;
}

function allocateRgbBandsForPixelCount(
  source: Uint8Array | Uint16Array,
  pixelCount: number,
): ReadonlyArray<Uint8Array | Uint16Array> {
  if (source instanceof Uint16Array) {
    return [
      new Uint16Array(pixelCount),
      new Uint16Array(pixelCount),
      new Uint16Array(pixelCount),
    ];
  }
  return [
    new Uint8Array(pixelCount),
    new Uint8Array(pixelCount),
    new Uint8Array(pixelCount),
  ];
}

function fillBandsFromInterleavedSource(
  bands: ReadonlyArray<Uint8Array | Uint16Array>,
  source: Uint8Array | Uint16Array,
  pixelCount: number,
): void {
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
    const baseOffset = pixelIndex * RAW_RGB_BAND_COUNT;
    bands[0]![pixelIndex] = source[baseOffset]!;
    bands[1]![pixelIndex] = source[baseOffset + 1]!;
    bands[2]![pixelIndex] = source[baseOffset + 2]!;
  }
}

function buildRasterImageFromLayoutAndBands(
  layout: LibRawDecodedLayout,
  bandPixels: ReadonlyArray<RasterTypedArray>,
): RasterImage {
  return {
    bandPixels,
    width: layout.width,
    height: layout.height,
    bitsPerSample: layout.bitsPerSample,
    sampleFormat: pickRasterSampleFormatForBitsPerSample(layout.bitsPerSample),
    bandCount: RAW_RGB_BAND_COUNT,
    bandLabels: RAW_BAND_LABELS,
  };
}

function pickRasterSampleFormatForBitsPerSample(_bps: number): RasterSampleFormat {
  return "uint";
}
