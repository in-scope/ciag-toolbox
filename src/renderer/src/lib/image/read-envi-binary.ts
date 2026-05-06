import {
  describeSupportedEnviDataTypeOrThrow,
  type EnviDataTypeDescriptor,
} from "@/lib/image/envi-data-type";
import type { EnviHeader } from "@/lib/image/parse-envi-header";
import type { RasterTypedArray } from "@/lib/image/raster-image";

export function readEnviBinaryAsBandPixels(
  header: EnviHeader,
  binary: Uint8Array,
): ReadonlyArray<RasterTypedArray> {
  const descriptor = describeSupportedEnviDataTypeOrThrow(header.dataType);
  rejectInsufficientBinarySize(header, binary, descriptor);
  const bandPixels = allocateBandPixelsForHeader(header, descriptor);
  fillBandPixelsAccordingToInterleave(header, binary, descriptor, bandPixels);
  return bandPixels;
}

interface InterleaveLayout {
  readonly samples: number;
  readonly lines: number;
  readonly bands: number;
  readonly bytesPerSample: number;
  readonly headerOffset: number;
  readonly isLittleEndian: boolean;
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

function fillBandPixelsAccordingToInterleave(
  header: EnviHeader,
  binary: Uint8Array,
  descriptor: EnviDataTypeDescriptor,
  bandPixels: RasterTypedArray[],
): void {
  const view = createBinaryDataView(binary);
  const layout = buildInterleaveLayoutFromHeader(header, descriptor);
  if (header.interleave === "bsq") {
    fillFromBandSequentialBinary(view, layout, bandPixels, descriptor);
    return;
  }
  if (header.interleave === "bil") {
    fillFromBandInterleavedByLineBinary(view, layout, bandPixels, descriptor);
    return;
  }
  fillFromBandInterleavedByPixelBinary(view, layout, bandPixels, descriptor);
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
  };
}

function fillFromBandSequentialBinary(
  view: DataView,
  layout: InterleaveLayout,
  bandPixels: RasterTypedArray[],
  descriptor: EnviDataTypeDescriptor,
): void {
  const bandSampleCount = layout.samples * layout.lines;
  for (let bandIndex = 0; bandIndex < layout.bands; bandIndex++) {
    const band = bandPixels[bandIndex]!;
    const baseByteOffset = layout.headerOffset + bandIndex * bandSampleCount * layout.bytesPerSample;
    fillBandFromContiguousByteRun(view, baseByteOffset, layout, band, descriptor);
  }
}

function fillBandFromContiguousByteRun(
  view: DataView,
  baseByteOffset: number,
  layout: InterleaveLayout,
  band: RasterTypedArray,
  descriptor: EnviDataTypeDescriptor,
): void {
  for (let i = 0; i < band.length; i++) {
    const byteOffset = baseByteOffset + i * layout.bytesPerSample;
    band[i] = descriptor.readSampleAtByteOffset(view, byteOffset, layout.isLittleEndian);
  }
}

function fillFromBandInterleavedByLineBinary(
  view: DataView,
  layout: InterleaveLayout,
  bandPixels: RasterTypedArray[],
  descriptor: EnviDataTypeDescriptor,
): void {
  const lineByteSize = layout.samples * layout.bytesPerSample;
  for (let line = 0; line < layout.lines; line++) {
    const lineBaseOffset = layout.headerOffset + line * layout.bands * lineByteSize;
    fillLineRunForEachBand(view, lineBaseOffset, line, layout, bandPixels, descriptor);
  }
}

function fillLineRunForEachBand(
  view: DataView,
  lineBaseOffset: number,
  line: number,
  layout: InterleaveLayout,
  bandPixels: RasterTypedArray[],
  descriptor: EnviDataTypeDescriptor,
): void {
  const lineByteSize = layout.samples * layout.bytesPerSample;
  for (let bandIndex = 0; bandIndex < layout.bands; bandIndex++) {
    const bandBaseOffset = lineBaseOffset + bandIndex * lineByteSize;
    const band = bandPixels[bandIndex]!;
    fillSamplesAlongOneBilLine(view, bandBaseOffset, line, layout, band, descriptor);
  }
}

function fillSamplesAlongOneBilLine(
  view: DataView,
  bandBaseOffset: number,
  line: number,
  layout: InterleaveLayout,
  band: RasterTypedArray,
  descriptor: EnviDataTypeDescriptor,
): void {
  for (let sample = 0; sample < layout.samples; sample++) {
    const byteOffset = bandBaseOffset + sample * layout.bytesPerSample;
    const pixelIndex = line * layout.samples + sample;
    band[pixelIndex] = descriptor.readSampleAtByteOffset(view, byteOffset, layout.isLittleEndian);
  }
}

function fillFromBandInterleavedByPixelBinary(
  view: DataView,
  layout: InterleaveLayout,
  bandPixels: RasterTypedArray[],
  descriptor: EnviDataTypeDescriptor,
): void {
  const pixelByteStride = layout.bands * layout.bytesPerSample;
  const totalPixels = layout.samples * layout.lines;
  for (let pixelIndex = 0; pixelIndex < totalPixels; pixelIndex++) {
    const pixelBaseOffset = layout.headerOffset + pixelIndex * pixelByteStride;
    fillBandsForOnePixel(view, pixelBaseOffset, pixelIndex, layout, bandPixels, descriptor);
  }
}

function fillBandsForOnePixel(
  view: DataView,
  pixelBaseOffset: number,
  pixelIndex: number,
  layout: InterleaveLayout,
  bandPixels: RasterTypedArray[],
  descriptor: EnviDataTypeDescriptor,
): void {
  for (let bandIndex = 0; bandIndex < layout.bands; bandIndex++) {
    const byteOffset = pixelBaseOffset + bandIndex * layout.bytesPerSample;
    const band = bandPixels[bandIndex]!;
    band[pixelIndex] = descriptor.readSampleAtByteOffset(view, byteOffset, layout.isLittleEndian);
  }
}
