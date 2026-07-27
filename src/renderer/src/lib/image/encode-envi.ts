import type {
  RasterImage,
  RasterSampleFormat,
  RasterSourceInterleave,
  RasterTypedArray,
} from "@/lib/image/raster-image";
import {
  computeArrayReportingPerUnitProgress,
  runInChunksReportingProgress,
  scaleProgressToWindow,
  type UnitProgressCallback,
} from "@/lib/image/unit-progress";

export interface EnviEncodedFiles {
  readonly headerBytes: Uint8Array;
  readonly binaryBytes: Uint8Array;
  readonly interleave: RasterSourceInterleave;
}

const DEFAULT_INTERLEAVE_FOR_NON_ENVI_SOURCE: RasterSourceInterleave = "bil";

const ENVI_BYTE_ORDER_LITTLE_ENDIAN = 0;

// CT-219f: samples written per main-thread slice in the chunked encoder; ~2M per-sample
// DataView writes keep each slice in the tens of milliseconds so the busy bar paints.
const DEFAULT_ENVI_SAMPLES_PER_CHUNK = 2_000_000;

// The float conversion copies one band per tick; the binary fill dominates the encode.
const FLOAT_CONVERSION_PROGRESS_WINDOW_END = 0.2;

export function encodeRasterImageAsFloat32EnviFiles(raster: RasterImage): EnviEncodedFiles {
  return encodeRasterImageAsEnviFiles(convertRasterImageToFloat32(raster));
}

function convertRasterImageToFloat32(raster: RasterImage): RasterImage {
  if (rasterIsAlreadyFloat32(raster)) return raster;
  return {
    ...raster,
    sampleFormat: "float",
    bitsPerSample: 32,
    bandPixels: raster.bandPixels.map(copyBandPixelsToFloat32),
  };
}

function rasterIsAlreadyFloat32(raster: RasterImage): boolean {
  return raster.sampleFormat === "float" && raster.bitsPerSample === 32;
}

function copyBandPixelsToFloat32(band: RasterTypedArray): Float32Array {
  const output = new Float32Array(band.length);
  output.set(band as never);
  return output;
}

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

// CT-219f: async twins of the encoders above. Byte-identical output (equivalence-tested),
// but the per-sample binary fill runs in chunks with paint yields so a reference-scale
// stack no longer freezes the renderer for the whole encode.
export async function encodeRasterImageAsEnviFilesReportingProgress(
  raster: RasterImage,
  onProgress?: UnitProgressCallback,
  samplesPerChunk: number = DEFAULT_ENVI_SAMPLES_PER_CHUNK,
): Promise<EnviEncodedFiles> {
  const interleave = pickEnviInterleaveFromRasterSource(raster);
  const dataType = pickEnviDataTypeForRasterOrThrow(raster);
  const binaryBytes = await writeEnviBinaryInChunksReportingProgress(
    raster,
    interleave,
    onProgress,
    samplesPerChunk,
  );
  const headerText = buildEnviHeaderTextForRaster(raster, interleave, dataType);
  return { headerBytes: encodeUtf8Text(headerText), binaryBytes, interleave };
}

export async function encodeRasterImageAsFloat32EnviFilesReportingProgress(
  raster: RasterImage,
  onProgress?: UnitProgressCallback,
  samplesPerChunk: number = DEFAULT_ENVI_SAMPLES_PER_CHUNK,
): Promise<EnviEncodedFiles> {
  if (rasterIsAlreadyFloat32(raster)) {
    return encodeRasterImageAsEnviFilesReportingProgress(raster, onProgress, samplesPerChunk);
  }
  const converted = await convertRasterImageToFloat32ReportingProgress(
    raster,
    scaleProgressToWindow(onProgress, 0, FLOAT_CONVERSION_PROGRESS_WINDOW_END),
  );
  return encodeRasterImageAsEnviFilesReportingProgress(
    converted,
    scaleProgressToWindow(onProgress, FLOAT_CONVERSION_PROGRESS_WINDOW_END, 1),
    samplesPerChunk,
  );
}

async function convertRasterImageToFloat32ReportingProgress(
  raster: RasterImage,
  onProgress: UnitProgressCallback | undefined,
): Promise<RasterImage> {
  const bandPixels = await computeArrayReportingPerUnitProgress(
    raster.bandCount,
    (bandIndex) => copyBandPixelsToFloat32(readBandPixelsOrThrow(raster, bandIndex)),
    onProgress,
  );
  return { ...raster, sampleFormat: "float", bitsPerSample: 32, bandPixels };
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
  const plan = buildEnviWritePlanForRaster(raster, interleave);
  const bytes = new Uint8Array(plan.totalUnits * plan.unitByteSize);
  writeEnviUnitRangeIntoView(plan, new DataView(bytes.buffer), 0, 0, plan.totalUnits);
  return bytes;
}

async function writeEnviBinaryInChunksReportingProgress(
  raster: RasterImage,
  interleave: RasterSourceInterleave,
  onProgress: UnitProgressCallback | undefined,
  samplesPerChunk: number,
): Promise<Uint8Array> {
  const plan = buildEnviWritePlanForRaster(raster, interleave);
  const bytes = new Uint8Array(plan.totalUnits * plan.unitByteSize);
  const view = new DataView(bytes.buffer);
  const unitsPerChunk = Math.max(1, Math.floor(samplesPerChunk / plan.samplesPerUnit));
  await runInChunksReportingProgress(
    plan.totalUnits,
    unitsPerChunk,
    (startUnit, endUnit) =>
      writeEnviUnitRangeIntoView(plan, view, startUnit * plan.unitByteSize, startUnit, endUnit),
    onProgress,
  );
  return bytes;
}

// CT-235: chunked encoding plan for the project bake. The header is built eagerly
// (small text); the binary NEVER materializes whole - byte length comes from the
// layout, and chunks are produced on demand so the caller can spool each one before
// the next exists. Every chunk is written by the SAME write plan the sync encoder
// iterates, so the concatenated chunks are byte-identical to encodeRasterImageAsEnviFiles.
export interface EnviChunkedEncoding {
  readonly headerBytes: Uint8Array;
  readonly binaryByteLength: number;
  readonly interleave: RasterSourceInterleave;
  readonly emitBinaryChunksInOrder: (
    maxChunkBytes: number,
    onChunk: (bytes: Uint8Array) => Promise<void>,
  ) => Promise<void>;
}

export function planEnviFilesChunkedEncoding(raster: RasterImage): EnviChunkedEncoding {
  const interleave = pickEnviInterleaveFromRasterSource(raster);
  const dataType = pickEnviDataTypeForRasterOrThrow(raster);
  const layout = buildBinaryLayoutForRaster(raster);
  const headerText = buildEnviHeaderTextForRaster(raster, interleave, dataType);
  return {
    headerBytes: encodeUtf8Text(headerText),
    binaryByteLength: layout.totalByteSize,
    interleave,
    emitBinaryChunksInOrder: (maxChunkBytes, onChunk) =>
      emitEnviBinaryChunksInOrder(buildEnviWritePlanForRaster(raster, interleave), maxChunkBytes, onChunk),
  };
}

// CT-237: float32 twin of the plan above for the ENVI (32-bit float) export.
// The source raster is NOT converted up front (a full float32 copy of a 10 GB
// stack would double resident memory); the float writer narrows each sample as
// the chunk is built, which matches Float32Array.set narrowing, so the output
// is byte-identical to encodeRasterImageAsFloat32EnviFiles.
export function planFloat32EnviFilesChunkedEncoding(raster: RasterImage): EnviChunkedEncoding {
  const interleave = pickEnviInterleaveFromRasterSource(raster);
  const layout = buildBinaryLayoutForRaster(raster, FLOAT32_BYTES_PER_SAMPLE);
  const headerText = buildEnviHeaderTextForRaster(raster, interleave, FLOAT32_ENVI_DATA_TYPE_CODE);
  return {
    headerBytes: encodeUtf8Text(headerText),
    binaryByteLength: layout.totalByteSize,
    interleave,
    emitBinaryChunksInOrder: (maxChunkBytes, onChunk) =>
      emitEnviBinaryChunksInOrder(buildFloat32EnviWritePlanForRaster(raster, interleave), maxChunkBytes, onChunk),
  };
}

const FLOAT32_ENVI_DATA_TYPE_CODE = 4;
const FLOAT32_BYTES_PER_SAMPLE = 4;

function buildFloat32EnviWritePlanForRaster(
  raster: RasterImage,
  interleave: RasterSourceInterleave,
): EnviInterleaveWritePlan {
  const layout = buildBinaryLayoutForRaster(raster, FLOAT32_BYTES_PER_SAMPLE);
  const writer = SAMPLE_WRITERS_BY_FORMAT_KEY.get("float:32")!;
  return buildEnviInterleaveWritePlan(raster, interleave, layout, writer);
}

async function emitEnviBinaryChunksInOrder(
  plan: EnviInterleaveWritePlan,
  maxChunkBytes: number,
  onChunk: (bytes: Uint8Array) => Promise<void>,
): Promise<void> {
  const unitsPerChunk = Math.max(1, Math.floor(maxChunkBytes / plan.unitByteSize));
  for (let startUnit = 0; startUnit < plan.totalUnits; startUnit += unitsPerChunk) {
    const endUnit = Math.min(plan.totalUnits, startUnit + unitsPerChunk);
    await onChunk(buildOneEnviBinaryChunk(plan, startUnit, endUnit));
  }
}

function buildOneEnviBinaryChunk(
  plan: EnviInterleaveWritePlan,
  startUnit: number,
  endUnit: number,
): Uint8Array {
  const bytes = new Uint8Array((endUnit - startUnit) * plan.unitByteSize);
  writeEnviUnitRangeIntoView(plan, new DataView(bytes.buffer), 0, startUnit, endUnit);
  return bytes;
}

// One unit is one row run of one band (bsq/bil) or one full image line (bip): a uniform,
// row-sized slice of the fill that the sync path, the progress-reporting path, and the
// CT-235 chunk emitter all iterate, so their outputs are identical by construction. Units
// are contiguous in file order, so unit i occupies bytes [i*unitByteSize, (i+1)*unitByteSize).
interface EnviInterleaveWritePlan {
  readonly totalUnits: number;
  readonly samplesPerUnit: number;
  readonly unitByteSize: number;
  readonly writeUnitAt: (view: DataView, unitByteOffset: number, unitIndex: number) => void;
}

function buildEnviWritePlanForRaster(
  raster: RasterImage,
  interleave: RasterSourceInterleave,
): EnviInterleaveWritePlan {
  const layout = buildBinaryLayoutForRaster(raster);
  const writer = pickSampleWriterForRaster(raster);
  return buildEnviInterleaveWritePlan(raster, interleave, layout, writer);
}

function writeEnviUnitRangeIntoView(
  plan: EnviInterleaveWritePlan,
  view: DataView,
  viewByteOffsetOfStartUnit: number,
  startUnit: number,
  endUnit: number,
): void {
  for (let unitIndex = startUnit; unitIndex < endUnit; unitIndex += 1) {
    const unitByteOffset = viewByteOffsetOfStartUnit + (unitIndex - startUnit) * plan.unitByteSize;
    plan.writeUnitAt(view, unitByteOffset, unitIndex);
  }
}

interface BinaryLayout {
  readonly samples: number;
  readonly lines: number;
  readonly bands: number;
  readonly bytesPerSample: number;
  readonly totalByteSize: number;
}

function buildBinaryLayoutForRaster(
  raster: RasterImage,
  bytesPerSampleOverride?: number,
): BinaryLayout {
  const bytesPerSample = bytesPerSampleOverride ?? readBytesPerSampleFromBandPixelsOrThrow(raster);
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

function buildEnviInterleaveWritePlan(
  raster: RasterImage,
  interleave: RasterSourceInterleave,
  layout: BinaryLayout,
  writer: SampleWriterFunction,
): EnviInterleaveWritePlan {
  if (interleave === "bsq") return buildBandSequentialWritePlan(raster, layout, writer);
  if (interleave === "bil") return buildBandInterleavedByLineWritePlan(raster, layout, writer);
  return buildBandInterleavedByPixelWritePlan(raster, layout, writer);
}

function buildBandSequentialWritePlan(
  raster: RasterImage,
  layout: BinaryLayout,
  writer: SampleWriterFunction,
): EnviInterleaveWritePlan {
  return {
    totalUnits: layout.bands * layout.lines,
    samplesPerUnit: layout.samples,
    unitByteSize: layout.samples * layout.bytesPerSample,
    writeUnitAt: (view, unitByteOffset, unitIndex) => {
      const bandIndex = Math.floor(unitIndex / layout.lines);
      const line = unitIndex % layout.lines;
      writeOneBandRowRunToBinary(view, unitByteOffset, line, layout, readBandPixelsOrThrow(raster, bandIndex), writer);
    },
  };
}

function buildBandInterleavedByLineWritePlan(
  raster: RasterImage,
  layout: BinaryLayout,
  writer: SampleWriterFunction,
): EnviInterleaveWritePlan {
  return {
    totalUnits: layout.lines * layout.bands,
    samplesPerUnit: layout.samples,
    unitByteSize: layout.samples * layout.bytesPerSample,
    writeUnitAt: (view, unitByteOffset, unitIndex) => {
      const line = Math.floor(unitIndex / layout.bands);
      const bandIndex = unitIndex % layout.bands;
      writeOneBandRowRunToBinary(view, unitByteOffset, line, layout, readBandPixelsOrThrow(raster, bandIndex), writer);
    },
  };
}

function writeOneBandRowRunToBinary(
  view: DataView,
  baseByteOffset: number,
  line: number,
  layout: BinaryLayout,
  band: RasterTypedArray,
  writer: SampleWriterFunction,
): void {
  for (let sample = 0; sample < layout.samples; sample++) {
    const byteOffset = baseByteOffset + sample * layout.bytesPerSample;
    const pixelIndex = line * layout.samples + sample;
    writer(view, byteOffset, band[pixelIndex] ?? 0);
  }
}

function buildBandInterleavedByPixelWritePlan(
  raster: RasterImage,
  layout: BinaryLayout,
  writer: SampleWriterFunction,
): EnviInterleaveWritePlan {
  const pixelByteStride = layout.bands * layout.bytesPerSample;
  return {
    totalUnits: layout.lines,
    samplesPerUnit: layout.samples * layout.bands,
    unitByteSize: layout.samples * pixelByteStride,
    writeUnitAt: (view, unitByteOffset, line) => {
      const firstPixelIndex = line * layout.samples;
      for (let sample = 0; sample < layout.samples; sample++) {
        const pixelBaseOffset = unitByteOffset + sample * pixelByteStride;
        writeAllBandsForOnePixel(view, pixelBaseOffset, firstPixelIndex + sample, raster, layout, writer);
      }
    },
  };
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
