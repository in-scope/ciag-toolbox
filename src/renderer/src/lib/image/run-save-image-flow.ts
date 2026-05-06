import {
  encodeViewportSourceForSaving,
  type EncodedSavedImage,
} from "@/lib/image/encode-saved-image";
import {
  findSaveImageFormatOptionOrThrow,
  type SaveImageFormatId,
} from "@/lib/image/save-image-formats";
import type { ViewportImageSource } from "@/lib/webgl/texture";

export interface SaveImageFlowInput {
  readonly source: ViewportImageSource;
  readonly selectedBandIndex: number;
  readonly originalFileName: string;
  readonly formatId: SaveImageFormatId;
}

export type SaveImageFlowResult =
  | { canceled: true }
  | { canceled: false; filePath: string };

export async function runSaveImageFlowThroughMainProcess(
  input: SaveImageFlowInput,
): Promise<SaveImageFlowResult> {
  const encoded = await encodeViewportSourceForSaving({
    source: input.source,
    selectedBandIndex: input.selectedBandIndex,
    formatId: input.formatId,
  });
  const formatOption = findSaveImageFormatOptionOrThrow(input.formatId);
  const suggestedFileName = buildSuggestedSavedFileName(input.originalFileName, formatOption.extension);
  return window.toolboxApi.saveImageDialog({
    suggestedFileName,
    bytes: encoded.bytes,
    fileFilter: formatOption.fileFilter,
    sidecar: pickSaveImageSidecarFromEncoded(encoded),
  });
}

function pickSaveImageSidecarFromEncoded(
  encoded: EncodedSavedImage,
): { extension: string; bytes: Uint8Array } | undefined {
  if (!encoded.sidecar) return undefined;
  return { extension: encoded.sidecar.extension, bytes: encoded.sidecar.bytes };
}

function buildSuggestedSavedFileName(
  originalFileName: string,
  extension: string,
): string {
  const stem = stripExtensionFromFileName(originalFileName);
  return `${stem}.${extension}`;
}

function stripExtensionFromFileName(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot <= 0) return fileName;
  return fileName.slice(0, lastDot);
}
