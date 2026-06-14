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

export function findSaveImageFormatOptionOrThrow(
  formatId: SaveImageFormatId,
): SaveImageFormatOption {
  const option = SAVE_IMAGE_FORMAT_OPTIONS.find((entry) => entry.id === formatId);
  if (!option) {
    throw new Error(`Unknown save format id: ${formatId}`);
  }
  return option;
}
