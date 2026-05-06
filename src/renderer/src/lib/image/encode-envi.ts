import type {
  RasterImage,
  RasterSampleFormat,
  RasterSourceInterleave,
  RasterTypedArray,
} from "@/lib/image/raster-image";

export interface EnviEncodedFiles {
  readonly headerBytes: Uint8Array;
  readonly binaryBytes: Uint8Array;
  readonly interleave: RasterSourceInterleave;
}

const DEFAULT_INTERLEAVE_FOR_NON_ENVI_SOURCE: RasterSourceInterleave = "bil";

const ENVI_BYTE_ORDER_LITTLE_ENDIAN = 0;

export function encodeRasterImageAsEnviFiles(raster: RasterImage): EnviEncodedFiles {
  const interleave = pickEnviInterleaveFromRasterSource(raster);
  const dataType = pickEnviDataTypeForRasterOrThrow(raster);
  const binaryBytes = writeRasterBandPixelsAsEnviBinary(raster, interleave);
  const headerText = buildEnviHeaderTextForRaster(raster, interleave, dataType);
  return {
    headerBytes: encodeUtf8Text(headerText),
    binaryBytes,
    interleave,
  };
}

function pickEnviInterleaveFromRasterSource(
  raster: RasterImage,
): RasterSourceInterleave {
  return raster.sourceInterleave ?? DEFAULT_INTERLEAVE_FOR_NON_ENVI_SOURCE;
}

function pickEnviDataTypeForRasterOrThrow(raster: RasterImage): number {
  return findEnviDataTypeCodeFromRasterFormatOrThrow(
    raster.sampleFormat,
    raster.bitsPerSample,
  );
}

function findEnviDataTypeCodeFromRasterFormatOrThrow(
  sampleFormat: RasterSampleFormat,
  bitsPerSample: number,
): number {
  for (const entry of SUPPORTED_ENVI_DATA_TYPE_LOOKUPS) {
    if (entry.sampleFormat === sampleFormat && entry.bitsPerSample === bitsPerSample) {
      return entry.code;
    }
  }
  throw new Error(
    `ENVI write does not support raster format ${sampleFormat} ${bitsPerSample}-bit`,
  );
}

interface EnviDataTypeLookupEntry {
  readonly code: number;
  readonly sampleFormat: RasterSampleFormat;
  readonly bitsPerSample: number;
}

const SUPPORTED_ENVI_DATA_TYPE_LOOKUPS: ReadonlyArray<EnviDataTypeLookupEntry> = [
  { code: 1, sampleFormat: "uint", bitsPerSample: 8 },
  { code: 2, sampleFormat: "int", bitsPerSample: 16 },
  { code: 3, sampleFormat: "int", bitsPerSample: 32 },
  { code: 4, sampleFormat: "float", bitsPerSample: 32 },
  { code: 12, sampleFormat: "uint", bitsPerSample: 16 },
  { code: 13, sampleFormat: "uint", bitsPerSample: 32 },
];

function buildEnviHeaderTextForRaster(
  raster: RasterImage,
  interleave: RasterSourceInterleave,
  dataType: number,
): string {
  const lines = buildRequiredEnviHeaderLines(raster, interleave, dataType);
  appendOptionalBandNamesLine(lines, raster);
  appendOptionalWavelengthLine(lines, raster);
  return lines.join("\n") + "\n";
}

function buildRequiredEnviHeaderLines(
  raster: RasterImage,
  interleave: RasterSourceInterleave,
  dataType: number,
): string[] {
  return [
    "ENVI",
    `samples = ${raster.width}`,
    `lines = ${raster.height}`,
    `bands = ${raster.bandCount}`,
    "header offset = 0",
    "file type = ENVI Standard",
    `data type = ${dataType}`,
    `interleave = ${interleave}`,
    `byte order = ${ENVI_BYTE_ORDER_LITTLE_ENDIAN}`,
  ];
}

function appendOptionalBandNamesLine(lines: string[], raster: RasterImage): void {
  if (!raster.bandLabels || raster.bandLabels.length !== raster.bandCount) return;
  lines.push(`band names = { ${raster.bandLabels.join(", ")} }`);
}

function appendOptionalWavelengthLine(lines: string[], raster: RasterImage): void {
  if (!raster.bandWavelengths || raster.bandWavelengths.length !== raster.bandCount) return;
  lines.push(`wavelength = { ${raster.bandWavelengths.join(", ")} }`);
}

function encodeUtf8Text(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function writeRasterBandPixelsAsEnviBinary(
  raster: RasterImage,
  interleave: RasterSourceInterleave,
): Uint8Array {
  const layout = buildBinaryLayoutForRaster(raster);
  const buffer = new ArrayBuffer(layout.totalByteSize);
  const view = new DataView(buffer);
  const writer = pickSampleWriterForRaster(raster);
  fillEnviBinaryAccordingToInterleave(view, raster, interleave, layout, writer);
  return new Uint8Array(buffer);
}

interface BinaryLayout {
  readonly samples: number;
  readonly lines: number;
  readonly bands: number;
  readonly bytesPerSample: number;
  readonly totalByteSize: number;
}

function buildBinaryLayoutForRaster(raster: RasterImage): BinaryLayout {
  const bytesPerSample = readBytesPerSampleFromBandPixelsOrThrow(raster);
  const totalSamples = raster.width * raster.height * raster.bandCount;
  return {
    samples: raster.width,
    lines: raster.height,
    bands: raster.bandCount,
    bytesPerSample,
    totalByteSize: totalSamples * bytesPerSample,
  };
}

function readBytesPerSampleFromBandPixelsOrThrow(raster: RasterImage): number {
  const firstBand = raster.bandPixels[0];
  if (!firstBand) {
    throw new Error("ENVI write requires a raster with at least one band");
  }
  return firstBand.BYTES_PER_ELEMENT;
}

type SampleWriterFunction = (
  view: DataView,
  byteOffset: number,
  value: number,
) => void;

function pickSampleWriterForRaster(raster: RasterImage): SampleWriterFunction {
  const writer = SAMPLE_WRITERS_BY_FORMAT_KEY.get(buildSampleFormatKey(raster));
  if (!writer) {
    throw new Error(
      `ENVI write does not support raster format ${raster.sampleFormat} ${raster.bitsPerSample}-bit`,
    );
  }
  return writer;
}

function buildSampleFormatKey(raster: RasterImage): string {
  return `${raster.sampleFormat}:${raster.bitsPerSample}`;
}

const SAMPLE_WRITERS_BY_FORMAT_KEY: ReadonlyMap<string, SampleWriterFunction> = new Map([
  ["uint:8", (view, offset, value) => view.setUint8(offset, value)],
  ["uint:16", (view, offset, value) => view.setUint16(offset, value, true)],
  ["uint:32", (view, offset, value) => view.setUint32(offset, value, true)],
  ["int:16", (view, offset, value) => view.setInt16(offset, value, true)],
  ["int:32", (view, offset, value) => view.setInt32(offset, value, true)],
  ["float:32", (view, offset, value) => view.setFloat32(offset, value, true)],
]);

function fillEnviBinaryAccordingToInterleave(
  view: DataView,
  raster: RasterImage,
  interleave: RasterSourceInterleave,
  layout: BinaryLayout,
  writer: SampleWriterFunction,
): void {
  if (interleave === "bsq") {
    writeBandSequentialBinary(view, raster, layout, writer);
    return;
  }
  if (interleave === "bil") {
    writeBandInterleavedByLineBinary(view, raster, layout, writer);
    return;
  }
  writeBandInterleavedByPixelBinary(view, raster, layout, writer);
}

function writeBandSequentialBinary(
  view: DataView,
  raster: RasterImage,
  layout: BinaryLayout,
  writer: SampleWriterFunction,
): void {
  const bandSampleCount = layout.samples * layout.lines;
  for (let bandIndex = 0; bandIndex < layout.bands; bandIndex++) {
    const band = readBandPixelsOrThrow(raster, bandIndex);
    const baseByteOffset = bandIndex * bandSampleCount * layout.bytesPerSample;
    writeContiguousBandRunToBinary(view, baseByteOffset, layout, band, writer);
  }
}

function writeContiguousBandRunToBinary(
  view: DataView,
  baseByteOffset: number,
  layout: BinaryLayout,
  band: RasterTypedArray,
  writer: SampleWriterFunction,
): void {
  for (let i = 0; i < band.length; i++) {
    const byteOffset = baseByteOffset + i * layout.bytesPerSample;
    writer(view, byteOffset, band[i] ?? 0);
  }
}

function writeBandInterleavedByLineBinary(
  view: DataView,
  raster: RasterImage,
  layout: BinaryLayout,
  writer: SampleWriterFunction,
): void {
  const lineByteSize = layout.samples * layout.bytesPerSample;
  for (let line = 0; line < layout.lines; line++) {
    const lineBaseOffset = line * layout.bands * lineByteSize;
    writeOneLineRunForEachBand(view, lineBaseOffset, line, raster, layout, writer);
  }
}

function writeOneLineRunForEachBand(
  view: DataView,
  lineBaseOffset: number,
  line: number,
  raster: RasterImage,
  layout: BinaryLayout,
  writer: SampleWriterFunction,
): void {
  const lineByteSize = layout.samples * layout.bytesPerSample;
  for (let bandIndex = 0; bandIndex < layout.bands; bandIndex++) {
    const band = readBandPixelsOrThrow(raster, bandIndex);
    const bandBaseOffset = lineBaseOffset + bandIndex * lineByteSize;
    writeSamplesAlongOneBilLine(view, bandBaseOffset, line, layout, band, writer);
  }
}

function writeSamplesAlongOneBilLine(
  view: DataView,
  bandBaseOffset: number,
  line: number,
  layout: BinaryLayout,
  band: RasterTypedArray,
  writer: SampleWriterFunction,
): void {
  for (let sample = 0; sample < layout.samples; sample++) {
    const byteOffset = bandBaseOffset + sample * layout.bytesPerSample;
    const pixelIndex = line * layout.samples + sample;
    writer(view, byteOffset, band[pixelIndex] ?? 0);
  }
}

function writeBandInterleavedByPixelBinary(
  view: DataView,
  raster: RasterImage,
  layout: BinaryLayout,
  writer: SampleWriterFunction,
): void {
  const pixelByteStride = layout.bands * layout.bytesPerSample;
  const totalPixels = layout.samples * layout.lines;
  for (let pixelIndex = 0; pixelIndex < totalPixels; pixelIndex++) {
    const pixelBaseOffset = pixelIndex * pixelByteStride;
    writeAllBandsForOnePixel(view, pixelBaseOffset, pixelIndex, raster, layout, writer);
  }
}

function writeAllBandsForOnePixel(
  view: DataView,
  pixelBaseOffset: number,
  pixelIndex: number,
  raster: RasterImage,
  layout: BinaryLayout,
  writer: SampleWriterFunction,
): void {
  for (let bandIndex = 0; bandIndex < layout.bands; bandIndex++) {
    const band = readBandPixelsOrThrow(raster, bandIndex);
    const byteOffset = pixelBaseOffset + bandIndex * layout.bytesPerSample;
    writer(view, byteOffset, band[pixelIndex] ?? 0);
  }
}

function readBandPixelsOrThrow(
  raster: RasterImage,
  bandIndex: number,
): RasterTypedArray {
  const band = raster.bandPixels[bandIndex];
  if (!band) {
    throw new Error(`Raster has no band at index ${bandIndex}`);
  }
  return band;
}
