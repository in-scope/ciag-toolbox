import {
  reportCompletedDecodeUnitAndYieldSoProgressCanPaint,
  reportMultiUnitDecodeStarting,
  type DecodeUnitProgressCallback,
} from "@/lib/image/decode-progress";
import {
  describeSupportedEnviDataTypeOrThrow,
  type EnviDataTypeDescriptor,
} from "@/lib/image/envi-data-type";
import type { EnviHeader, EnviInterleave } from "@/lib/image/parse-envi-header";
import type { RasterTypedArray } from "@/lib/image/raster-image";

export function readEnviBinaryAsBandPixels(
  header: EnviHeader,
  binary: Uint8Array,
): ReadonlyArray<RasterTypedArray> {
  const read = prepareEnviBandRead(header, binary);
  for (let bandIndex = 0; bandIndex < read.layout.bands; bandIndex++) {
    fillSingleBandFromBinary(read, bandIndex);
  }
  return read.bandPixels;
}

// CT-220: the same decode with one progress tick (and a paint yield) per band, so a
// large cube load can drive a determinate busy indicator.
export async function readEnviBinaryAsBandPixelsReportingPerBandProgress(
  header: EnviHeader,
  binary: Uint8Array,
  onDecodeProgress?: DecodeUnitProgressCallback,
): Promise<ReadonlyArray<RasterTypedArray>> {
  const read = prepareEnviBandRead(header, binary);
  reportMultiUnitDecodeStarting(onDecodeProgress, read.layout.bands);
  for (let bandIndex = 0; bandIndex < read.layout.bands; bandIndex++) {
    fillSingleBandFromBinary(read, bandIndex);
    await reportCompletedDecodeUnitAndYieldSoProgressCanPaint(onDecodeProgress, bandIndex + 1, read.layout.bands);
  }
  return read.bandPixels;
}

interface InterleaveLayout {
  readonly samples: number;
  readonly lines: number;
  readonly bands: number;
  readonly bytesPerSample: number;
  readonly headerOffset: number;
  readonly isLittleEndian: boolean;
  readonly interleave: EnviInterleave;
}

interface PreparedEnviBandRead {
  readonly view: DataView;
  readonly layout: InterleaveLayout;
  readonly descriptor: EnviDataTypeDescriptor;
  readonly bandPixels: RasterTypedArray[];
}

function prepareEnviBandRead(header: EnviHeader, binary: Uint8Array): PreparedEnviBandRead {
  const descriptor = describeSupportedEnviDataTypeOrThrow(header.dataType);
  rejectInsufficientBinarySize(header, binary, descriptor);
  return {
    view: createBinaryDataView(binary),
    layout: buildInterleaveLayoutFromHeader(header, descriptor),
    descriptor,
    bandPixels: allocateBandPixelsForHeader(header, descriptor),
  };
}

function rejectInsufficientBinarySize(
  header: EnviHeader,
  binary: Uint8Array,
  descriptor: EnviDataTypeDescriptor,
): void {
  const required = computeRequiredBinaryByteCount(header, descriptor);
  if (binary.byteLength < required) {
    throw new Error(
      `ENVI binary file is smaller than expected (${binary.byteLength} bytes, need ${required})`,
    );
  }
}

function computeRequiredBinaryByteCount(
  header: EnviHeader,
  descriptor: EnviDataTypeDescriptor,
): number {
  const sampleCount = header.samples * header.lines * header.bands;
  return header.headerOffset + sampleCount * descriptor.bytesPerSample;
}

function allocateBandPixelsForHeader(
  header: EnviHeader,
  descriptor: EnviDataTypeDescriptor,
): RasterTypedArray[] {
  const bandLength = header.samples * header.lines;
  const bandPixels: RasterTypedArray[] = [];
  for (let bandIndex = 0; bandIndex < header.bands; bandIndex++) {
    bandPixels.push(descriptor.allocateBandTypedArray(bandLength));
  }
  return bandPixels;
}

function createBinaryDataView(binary: Uint8Array): DataView {
  return new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
}

function buildInterleaveLayoutFromHeader(
  header: EnviHeader,
  descriptor: EnviDataTypeDescriptor,
): InterleaveLayout {
  return {
    samples: header.samples,
    lines: header.lines,
    bands: header.bands,
    bytesPerSample: descriptor.bytesPerSample,
    headerOffset: header.headerOffset,
    isLittleEndian: header.byteOrder === 0,
    interleave: header.interleave,
  };
}

function fillSingleBandFromBinary(read: PreparedEnviBandRead, bandIndex: number): void {
  const band = read.bandPixels[bandIndex]!;
  if (read.layout.interleave === "bsq") {
    fillBandFromBandSequentialBinary(read, bandIndex, band);
    return;
  }
  if (read.layout.interleave === "bil") {
    fillBandFromLineInterleavedBinary(read, bandIndex, band);
    return;
  }
  fillBandFromPixelInterleavedBinary(read, bandIndex, band);
}

function fillBandFromBandSequentialBinary(
  read: PreparedEnviBandRead,
  bandIndex: number,
  band: RasterTypedArray,
): void {
  const { layout } = read;
  const bandSampleCount = layout.samples * layout.lines;
  const baseByteOffset = layout.headerOffset + bandIndex * bandSampleCount * layout.bytesPerSample;
  for (let i = 0; i < band.length; i++) {
    const byteOffset = baseByteOffset + i * layout.bytesPerSample;
    band[i] = read.descriptor.readSampleAtByteOffset(read.view, byteOffset, layout.isLittleEndian);
  }
}

function fillBandFromLineInterleavedBinary(
  read: PreparedEnviBandRead,
  bandIndex: number,
  band: RasterTypedArray,
): void {
  const lineByteSize = read.layout.samples * read.layout.bytesPerSample;
  for (let line = 0; line < read.layout.lines; line++) {
    const lineBaseOffset = read.layout.headerOffset + line * read.layout.bands * lineByteSize;
    fillSamplesAlongOneBilLine(read, lineBaseOffset + bandIndex * lineByteSize, line, band);
  }
}

function fillSamplesAlongOneBilLine(
  read: PreparedEnviBandRead,
  bandLineBaseOffset: number,
  line: number,
  band: RasterTypedArray,
): void {
  const { layout } = read;
  for (let sample = 0; sample < layout.samples; sample++) {
    const byteOffset = bandLineBaseOffset + sample * layout.bytesPerSample;
    const pixelIndex = line * layout.samples + sample;
    band[pixelIndex] = read.descriptor.readSampleAtByteOffset(read.view, byteOffset, layout.isLittleEndian);
  }
}

function fillBandFromPixelInterleavedBinary(
  read: PreparedEnviBandRead,
  bandIndex: number,
  band: RasterTypedArray,
): void {
  const { layout } = read;
  const pixelByteStride = layout.bands * layout.bytesPerSample;
  const bandByteOffset = layout.headerOffset + bandIndex * layout.bytesPerSample;
  for (let pixelIndex = 0; pixelIndex < band.length; pixelIndex++) {
    const byteOffset = bandByteOffset + pixelIndex * pixelByteStride;
    band[pixelIndex] = read.descriptor.readSampleAtByteOffset(read.view, byteOffset, layout.isLittleEndian);
  }
}
