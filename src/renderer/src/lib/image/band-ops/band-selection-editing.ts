import type { BandSelectionEditingState, BandSelectionPreset } from "./band-selection";

// CT-210: pure helpers shared by the band-selection editor. A custom formula/tool
// returns the band as row-major nested arrays (validated by the return contract);
// flattening it to one Float32Array is the shape the result store and the float
// raster path both expect. The descriptor names the current choice for the panel's
// status line and, for a custom result, is what the audit trail records.

export const BAND_SELECTION_PRESET_LABELS: Record<BandSelectionPreset, string> = {
  average: "Average",
  variance: "Variance",
};

export const FORMULA_BAND_SELECTION_DESCRIPTION = "Formula";

export function flattenBandMatrixToFloat32(
  rows: ReadonlyArray<ReadonlyArray<number>>,
  width: number,
  height: number,
): Float32Array {
  const output = new Float32Array(width * height);
  for (let row = 0; row < height; row += 1) {
    copyBandRowIntoFloat32(output, rows[row] ?? [], row, width);
  }
  return output;
}

function copyBandRowIntoFloat32(
  output: Float32Array,
  row: ReadonlyArray<number>,
  rowIndex: number,
  width: number,
): void {
  for (let column = 0; column < width; column += 1) {
    output[rowIndex * width + column] = row[column] ?? 0;
  }
}

export function describeBandSelectionFunction(choice: BandSelectionEditingState | null): string {
  if (!choice) return "";
  return choice.kind === "custom" ? choice.description : BAND_SELECTION_PRESET_LABELS[choice.preset];
}

export function describeImportedToolBandSelection(sourceName: string | undefined): string {
  return `Imported tool: ${sourceName ?? "script"}`;
}
