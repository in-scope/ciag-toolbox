import type { TargetBitDepth } from "@/lib/image/encode-tiff";

export type SaveImageFormatId =
  | "tiff-16-bit"
  | "tiff-8-bit"
  | "tiff-float-32"
  | "png-8-bit"
  | "jpeg-8-bit"
  | "envi"
  | "envi-float";

export interface SaveImageFormatOption {
  readonly id: SaveImageFormatId;
  readonly label: string;
  readonly description: string;
  readonly extension: string;
  readonly fileFilter: { readonly name: string; readonly extensions: ReadonlyArray<string> };
}

export const SAVE_IMAGE_FORMAT_OPTIONS: ReadonlyArray<SaveImageFormatOption> = [
  {
    id: "tiff-16-bit",
    label: "TIFF (16-bit)",
    description: "Lossless, high dynamic range. Best for archiving raster data.",
    extension: "tif",
    fileFilter: { name: "TIFF Image", extensions: ["tif", "tiff"] },
  },
  {
    id: "tiff-8-bit",
    label: "TIFF (8-bit)",
    description: "Lossless, 8-bit per channel. Smaller files; reduced precision.",
    extension: "tif",
    fileFilter: { name: "TIFF Image", extensions: ["tif", "tiff"] },
  },
  {
    id: "tiff-float-32",
    label: "TIFF (32-bit float)",
    description: "Lossless float. Preserves out-of-range values after normalize/standardize.",
    extension: "tif",
    fileFilter: { name: "TIFF Image", extensions: ["tif", "tiff"] },
  },
  {
    id: "png-8-bit",
    label: "PNG (8-bit)",
    description: "Lossless, broadly compatible. 8-bit per channel.",
    extension: "png",
    fileFilter: { name: "PNG Image", extensions: ["png"] },
  },
  {
    id: "jpeg-8-bit",
    label: "JPEG (8-bit)",
    description: "Lossy compression. Smallest files; suited to display copies.",
    extension: "jpg",
    fileFilter: { name: "JPEG Image", extensions: ["jpg", "jpeg"] },
  },
  {
    id: "envi",
    label: "ENVI (.hdr + .bin)",
    description: "Multi-band scientific format. Writes a paired header and binary file.",
    extension: "hdr",
    fileFilter: { name: "ENVI Header", extensions: ["hdr"] },
  },
  {
    id: "envi-float",
    label: "ENVI (32-bit float)",
    description: "Multi-band float ENVI. Preserves out-of-range values losslessly.",
    extension: "hdr",
    fileFilter: { name: "ENVI Header", extensions: ["hdr"] },
  },
];

export type SaveImageFormatKind = "tiff" | "png" | "jpeg" | "envi";

export type SaveImageSampleFormat = "uint" | "float";

export interface SaveImageFormatTechnicalDetails {
  readonly kind: SaveImageFormatKind;
  readonly targetBitDepth: TargetBitDepth;
  readonly targetSampleFormat: SaveImageSampleFormat;
}

export function readSaveImageFormatTechnicalDetails(
  formatId: SaveImageFormatId,
): SaveImageFormatTechnicalDetails {
  switch (formatId) {
    case "tiff-16-bit":
      return { kind: "tiff", targetBitDepth: 16, targetSampleFormat: "uint" };
    case "tiff-8-bit":
      return { kind: "tiff", targetBitDepth: 8, targetSampleFormat: "uint" };
    case "tiff-float-32":
      return { kind: "tiff", targetBitDepth: 16, targetSampleFormat: "float" };
    case "png-8-bit":
      return { kind: "png", targetBitDepth: 8, targetSampleFormat: "uint" };
    case "jpeg-8-bit":
      return { kind: "jpeg", targetBitDepth: 8, targetSampleFormat: "uint" };
    case "envi":
      return { kind: "envi", targetBitDepth: 16, targetSampleFormat: "uint" };
    case "envi-float":
      return { kind: "envi", targetBitDepth: 16, targetSampleFormat: "float" };
  }
}

const ENVI_NEEDS_RASTER_REASON =
  "ENVI is for raster/scientific stacks; not available for photo (PNG/JPG) sources.";
const FLOAT_NEEDS_RASTER_REASON =
  "Float export needs raster data; an 8-bit photo has none.";

// CT-173: a true-colour photo (a PNG/JPG promoted to an RGB composite) is presented as one
// 8-bit colour image, so the scientific-only export formats - ENVI, ENVI float and 32-bit
// float TIFF - do not apply to it. Every other raster, including a single-band grayscale photo
// promoted to a raster and a scientific stack, can use every format (null = enabled). The
// "is this a photo?" decision is the colour flag, NOT the source kind (photos are rasters now).
export function describeSaveImageFormatDisabledReason(
  formatId: SaveImageFormatId,
  isTrueColorPhoto: boolean,
): string | null {
  if (!isTrueColorPhoto) return null;
  if (formatId === "envi" || formatId === "envi-float") return ENVI_NEEDS_RASTER_REASON;
  if (formatId === "tiff-float-32") return FLOAT_NEEDS_RASTER_REASON;
  return null;
}

export interface SaveImageSourceBandInfo {
  readonly isTrueColorPhoto: boolean;
  readonly bandCount: number;
  readonly selectedBandNumber: number;
}

// A multi-band SCIENTIFIC stack loses bands silently when saved to a single-band format
// (TIFF/PNG/JPEG keep only the displayed band; ENVI writes the whole cube). This note discloses
// that before the user confirms. A single-band stack and a true-colour photo (shown as one
// colour image, not browsable bands) lose nothing, so they get null.
export function describeSaveImageFormatBandCoverageNote(
  formatId: SaveImageFormatId,
  source: SaveImageSourceBandInfo,
): string | null {
  if (!sourceIsMultiBandStack(source)) return null;
  if (formatSavesEveryBand(formatId)) return describeSavesAllBandsNote(source.bandCount);
  return describeCurrentBandOnlyWarning(source.selectedBandNumber, source.bandCount);
}

function sourceIsMultiBandStack(source: SaveImageSourceBandInfo): boolean {
  return !source.isTrueColorPhoto && source.bandCount > 1;
}

function formatSavesEveryBand(formatId: SaveImageFormatId): boolean {
  return readSaveImageFormatTechnicalDetails(formatId).kind === "envi";
}

function describeCurrentBandOnlyWarning(bandNumber: number, bandCount: number): string {
  return `Saves the current band only (band ${bandNumber} of ${bandCount}). Use ENVI to save all bands.`;
}

function describeSavesAllBandsNote(bandCount: number): string {
  return `Saves all ${bandCount} bands.`;
}

export function findSaveImageFormatOptionOrThrow(
  formatId: SaveImageFormatId,
): SaveImageFormatOption {
  const option = SAVE_IMAGE_FORMAT_OPTIONS.find((entry) => entry.id === formatId);
  if (!option) {
    throw new Error(`Unknown save format id: ${formatId}`);
  }
  return option;
}
