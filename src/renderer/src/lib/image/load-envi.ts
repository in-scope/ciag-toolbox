import { type DecodeUnitProgressCallback } from "@/lib/image/decode-progress";
import { describeSupportedEnviDataTypeOrThrow } from "@/lib/image/envi-data-type";
import {
  parseEnviHeaderText,
  type EnviHeader,
} from "@/lib/image/parse-envi-header";
import type { RasterImage, RasterTypedArray } from "@/lib/image/raster-image";
import {
  readEnviBinaryAsBandPixels,
  readEnviBinaryAsBandPixelsReportingPerBandProgress,
} from "@/lib/image/read-envi-binary";

export function loadEnviAsRaster(
  headerBytes: Uint8Array,
  binaryBytes: Uint8Array,
): RasterImage {
  const header = parseEnviHeaderText(decodeHeaderBytesAsUtf8Text(headerBytes));
  const bandPixels = readEnviBinaryAsBandPixels(header, binaryBytes);
  return buildRasterImageFromEnviHeaderAndBandPixels(header, bandPixels);
}

// CT-220: the same load with one progress tick per decoded band, for determinate
// busy indicators on large cube opens.
export async function loadEnviAsRasterReportingPerBandProgress(
  headerBytes: Uint8Array,
  binaryBytes: Uint8Array,
  onDecodeProgress?: DecodeUnitProgressCallback,
): Promise<RasterImage> {
  const header = parseEnviHeaderText(decodeHeaderBytesAsUtf8Text(headerBytes));
  const bandPixels = await readEnviBinaryAsBandPixelsReportingPerBandProgress(
    header,
    binaryBytes,
    onDecodeProgress,
  );
  return buildRasterImageFromEnviHeaderAndBandPixels(header, bandPixels);
}

function decodeHeaderBytesAsUtf8Text(headerBytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(headerBytes);
}

function buildRasterImageFromEnviHeaderAndBandPixels(
  header: EnviHeader,
  bandPixels: ReadonlyArray<RasterTypedArray>,
): RasterImage {
  const descriptor = describeSupportedEnviDataTypeOrThrow(header.dataType);
  return {
    bandPixels,
    width: header.samples,
    height: header.lines,
    bitsPerSample: descriptor.bitsPerSample,
    sampleFormat: descriptor.sampleFormat,
    bandCount: header.bands,
    bandLabels: pickBandLabelsForHeader(header),
    bandWavelengths: header.wavelengths,
    sourceInterleave: header.interleave,
  };
}

function pickBandLabelsForHeader(header: EnviHeader): ReadonlyArray<string> | undefined {
  if (header.bandNames && header.bandNames.length === header.bands) return header.bandNames;
  return undefined;
}
