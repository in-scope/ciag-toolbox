import type { RasterImage } from "@/lib/image/raster-image";
import { getImageSourceDimensions, type ViewportImageSource } from "@/lib/webgl/texture";

export type ImageFormatLabel = "TIFF" | "PNG" | "JPEG" | "ENVI" | "Raw" | "Image";

export interface ViewportImageMetadataDisplay {
  readonly filePath: string;
  readonly format: ImageFormatLabel;
  readonly width: string;
  readonly height: string;
  readonly bitsPerSample: string;
  readonly sampleFormat: string;
  readonly bandCount: string;
  readonly fileSize: string;
}

export interface ViewportImageMetadataInputs {
  readonly fileName: string;
  readonly source: ViewportImageSource;
  readonly originalFilePath?: string;
  readonly fileSizeBytes?: number;
  readonly currentProjectFilePath: string | null;
}

const UNKNOWN_FIELD_PLACEHOLDER = "-";

const RAW_CAMERA_EXTENSIONS: ReadonlyArray<string> = [
  ".dng",
  ".cr3",
  ".arw",
  ".nef",
  ".raf",
  ".orf",
  ".pef",
  ".rw2",
];

const FILE_SIZE_UNIT_DESCRIPTORS: ReadonlyArray<FileSizeUnitDescriptor> = [
  { suffix: "GB", divisor: 1024 * 1024 * 1024 },
  { suffix: "MB", divisor: 1024 * 1024 },
  { suffix: "KB", divisor: 1024 },
];

interface FileSizeUnitDescriptor {
  readonly suffix: string;
  readonly divisor: number;
}

export function buildViewportImageMetadataDisplay(
  inputs: ViewportImageMetadataInputs,
): ViewportImageMetadataDisplay {
  const dimensions = getImageSourceDimensions(inputs.source);
  const rasterOrNull = readRasterFromSourceOrNull(inputs.source);
  return {
    filePath: resolveFilePathDisplayValue(inputs),
    format: detectImageFormatFromFileName(inputs.fileName),
    width: String(dimensions.width),
    height: String(dimensions.height),
    bitsPerSample: rasterOrNull ? String(rasterOrNull.bitsPerSample) : UNKNOWN_FIELD_PLACEHOLDER,
    sampleFormat: rasterOrNull ? rasterOrNull.sampleFormat : UNKNOWN_FIELD_PLACEHOLDER,
    bandCount: rasterOrNull ? String(rasterOrNull.bandCount) : UNKNOWN_FIELD_PLACEHOLDER,
    fileSize: formatFileSizeBytesForDisplay(inputs.fileSizeBytes),
  };
}

export function detectImageFormatFromFileName(fileName: string): ImageFormatLabel {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".tif") || lower.endsWith(".tiff")) return "TIFF";
  if (lower.endsWith(".png")) return "PNG";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "JPEG";
  if (lower.endsWith(".hdr")) return "ENVI";
  if (looksLikeRawCameraFileName(lower)) return "Raw";
  return "Image";
}

function looksLikeRawCameraFileName(lowerCaseFileName: string): boolean {
  return RAW_CAMERA_EXTENSIONS.some((ext) => lowerCaseFileName.endsWith(ext));
}

export function formatFileSizeBytesForDisplay(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return UNKNOWN_FIELD_PLACEHOLDER;
  }
  const unit = pickLargestApplicableFileSizeUnit(bytes);
  if (!unit) return `${bytes} B`;
  return `${(bytes / unit.divisor).toFixed(1)} ${unit.suffix}`;
}

function pickLargestApplicableFileSizeUnit(
  bytes: number,
): FileSizeUnitDescriptor | null {
  for (const unit of FILE_SIZE_UNIT_DESCRIPTORS) {
    if (bytes >= unit.divisor) return unit;
  }
  return null;
}

export function formatRelativeOrAbsoluteFilePathForDisplay(
  absoluteSourcePath: string,
  projectFilePath: string | null,
): string {
  const normalizedSource = normalizePathSeparatorsToForwardSlash(absoluteSourcePath);
  if (!projectFilePath) return normalizedSource;
  const projectDir = stripFinalPathSegment(
    normalizePathSeparatorsToForwardSlash(projectFilePath),
  );
  return computeRelativePathOrFallToAbsolute(normalizedSource, projectDir);
}

function normalizePathSeparatorsToForwardSlash(path: string): string {
  return path.replace(/\\/g, "/");
}

function stripFinalPathSegment(forwardSlashPath: string): string {
  const lastSlash = forwardSlashPath.lastIndexOf("/");
  if (lastSlash <= 0) return forwardSlashPath;
  return forwardSlashPath.slice(0, lastSlash);
}

function computeRelativePathOrFallToAbsolute(
  forwardSlashSourcePath: string,
  forwardSlashProjectDir: string,
): string {
  const prefix = forwardSlashProjectDir + "/";
  if (forwardSlashSourcePath.toLowerCase().startsWith(prefix.toLowerCase())) {
    return forwardSlashSourcePath.slice(prefix.length);
  }
  return forwardSlashSourcePath;
}

function readRasterFromSourceOrNull(source: ViewportImageSource): RasterImage | null {
  if (source.kind !== "raster") return null;
  return source.raster;
}

function resolveFilePathDisplayValue(inputs: ViewportImageMetadataInputs): string {
  if (!inputs.originalFilePath) return inputs.fileName;
  return formatRelativeOrAbsoluteFilePathForDisplay(
    inputs.originalFilePath,
    inputs.currentProjectFilePath,
  );
}
