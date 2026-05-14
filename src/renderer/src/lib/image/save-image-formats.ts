import type { TargetBitDepth } from "@/lib/image/encode-tiff";

export type SaveImageFormatId =
  | "tiff-16-bit"
  | "tiff-8-bit"
  | "png-8-bit"
  | "jpeg-8-bit"
  | "envi";

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
];

export type SaveImageFormatKind = "tiff" | "png" | "jpeg" | "envi";

export interface SaveImageFormatTechnicalDetails {
  readonly kind: SaveImageFormatKind;
  readonly targetBitDepth: TargetBitDepth;
}

export function readSaveImageFormatTechnicalDetails(
  formatId: SaveImageFormatId,
): SaveImageFormatTechnicalDetails {
  switch (formatId) {
    case "tiff-16-bit":
      return { kind: "tiff", targetBitDepth: 16 };
    case "tiff-8-bit":
      return { kind: "tiff", targetBitDepth: 8 };
    case "png-8-bit":
      return { kind: "png", targetBitDepth: 8 };
    case "jpeg-8-bit":
      return { kind: "jpeg", targetBitDepth: 8 };
    case "envi":
      return { kind: "envi", targetBitDepth: 16 };
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
