import {
  clampBandIndexToRaster,
  formatRasterBandIdentityText,
  type RasterImage,
} from "@/lib/image/raster-image";

export interface ViewportHeaderLabelInput {
  readonly fileName: string;
  readonly raster: RasterImage | null;
  readonly selectedBandIndex: number;
  readonly lastAppliedOperationLabel: string | null;
}

export function formatViewportHeaderLabel(input: ViewportHeaderLabelInput): string {
  const fileWithOperation = appendOperationLabelToFileName(
    input.fileName,
    input.lastAppliedOperationLabel,
  );
  const activeBand = describeActiveBandForHeaderOrNull(input.raster, input.selectedBandIndex);
  if (activeBand === null) return fileWithOperation;
  return `${fileWithOperation} - ${activeBand}`;
}

function appendOperationLabelToFileName(
  fileName: string,
  lastAppliedOperationLabel: string | null,
): string {
  if (!lastAppliedOperationLabel) return fileName;
  return `${fileName} (${lastAppliedOperationLabel})`;
}

function describeActiveBandForHeaderOrNull(
  raster: RasterImage | null,
  selectedBandIndex: number,
): string | null {
  if (!raster || raster.bandCount <= 1) return null;
  const bandIndex = clampBandIndexToRaster(raster, selectedBandIndex);
  return formatRasterBandIdentityText(raster, bandIndex);
}
