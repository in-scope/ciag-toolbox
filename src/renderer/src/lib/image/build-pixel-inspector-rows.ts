import {
  computePerBandNormalizedFractionsForReadout,
  formatSinglePixelReadoutValue,
} from "@/lib/image/compute-pixel-readout";
import type { SingleBandScalarExtents } from "@/lib/image/compute-image-channel-extents";
import {
  getRasterBandLabelOrDefault,
  type RasterImage,
  type RasterSampleFormat,
} from "@/lib/image/raster-image";

const BROWSER_PIXEL_LABEL = "Pixel";
const BROWSER_SAMPLE_FORMAT: RasterSampleFormat = "uint";
const BROWSER_BYTE_MAX = 255;

export interface PixelInspectorRow {
  readonly bandIndex: number;
  readonly label: string;
  readonly displayValue: string;
  readonly normalizedFraction: number | null;
}

export interface PixelInspectorActiveRoiMeans {
  readonly bandMeans: ReadonlyArray<number>;
}

export interface BuildRasterPixelInspectorRowsInputs {
  readonly raster: RasterImage;
  readonly perBandRawValueExtents: ReadonlyArray<SingleBandScalarExtents>;
  readonly cursorBandValues: ReadonlyArray<number> | null;
  readonly roiMeanBandValues: ReadonlyArray<number> | null;
}

export function buildRasterPixelInspectorRows(
  inputs: BuildRasterPixelInspectorRowsInputs,
): ReadonlyArray<PixelInspectorRow> {
  const values = pickRasterValuesToDisplay(inputs);
  const normalizedFractions = computePerBandNormalizedFractionsForReadout(
    values,
    inputs.perBandRawValueExtents,
  );
  return buildRowsForRaster(inputs.raster, values, normalizedFractions);
}

function pickRasterValuesToDisplay(
  inputs: BuildRasterPixelInspectorRowsInputs,
): ReadonlyArray<number> | null {
  if (inputs.cursorBandValues) return inputs.cursorBandValues;
  if (inputs.roiMeanBandValues && inputs.roiMeanBandValues.length === inputs.raster.bandCount) {
    return inputs.roiMeanBandValues;
  }
  return null;
}

function buildRowsForRaster(
  raster: RasterImage,
  values: ReadonlyArray<number> | null,
  normalizedFractions: ReadonlyArray<number | null>,
): ReadonlyArray<PixelInspectorRow> {
  const rows: PixelInspectorRow[] = [];
  for (let bandIndex = 0; bandIndex < raster.bandCount; bandIndex += 1) {
    rows.push(buildRasterRowForBandIndex(raster, bandIndex, values, normalizedFractions));
  }
  return rows;
}

function buildRasterRowForBandIndex(
  raster: RasterImage,
  bandIndex: number,
  values: ReadonlyArray<number> | null,
  normalizedFractions: ReadonlyArray<number | null>,
): PixelInspectorRow {
  return {
    bandIndex,
    label: getRasterBandLabelOrDefault(raster, bandIndex),
    displayValue: formatRasterBandDisplayValue(values, bandIndex, raster.sampleFormat),
    normalizedFraction: normalizedFractions[bandIndex] ?? null,
  };
}

function formatRasterBandDisplayValue(
  values: ReadonlyArray<number> | null,
  bandIndex: number,
  sampleFormat: RasterSampleFormat,
): string {
  const rawValue = values?.[bandIndex];
  if (rawValue === undefined) return "-";
  return formatSinglePixelReadoutValue(rawValue, sampleFormat);
}

export function buildBrowserSourcePixelInspectorRow(
  cursorRgbaValues: ReadonlyArray<number> | null,
): PixelInspectorRow {
  return {
    bandIndex: 0,
    label: BROWSER_PIXEL_LABEL,
    displayValue: formatBrowserDisplayValue(cursorRgbaValues),
    normalizedFraction: computeBrowserRowNormalizedFraction(cursorRgbaValues),
  };
}

function formatBrowserDisplayValue(
  cursorRgbaValues: ReadonlyArray<number> | null,
): string {
  if (!cursorRgbaValues) return "-";
  return cursorRgbaValues
    .map((value) => formatSinglePixelReadoutValue(value, BROWSER_SAMPLE_FORMAT))
    .join(", ");
}

function computeBrowserRowNormalizedFraction(
  cursorRgbaValues: ReadonlyArray<number> | null,
): number | null {
  if (!cursorRgbaValues) return null;
  const meanByte = meanOfRgbBytesOrNull(cursorRgbaValues);
  if (meanByte === null) return null;
  return meanByte / BROWSER_BYTE_MAX;
}

function meanOfRgbBytesOrNull(values: ReadonlyArray<number>): number | null {
  const rgb = values.slice(0, 3);
  if (rgb.length === 0) return null;
  const sum = rgb.reduce((accumulator, value) => accumulator + value, 0);
  return sum / rgb.length;
}
