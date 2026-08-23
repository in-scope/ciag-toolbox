import { SAVE_IMAGE_CHUNK_BYTES } from "@shared/chunked-save-image-protocol";

import { emitBufferInBoundedSlicesInOrder } from "@/lib/image/emit-byte-chunks";
import { sanitizeExportBaseName } from "@/lib/image/export-base-name";
import type { SaveImageFlowApi } from "@/lib/image/run-save-image-flow";
import { describeElectronInvokeFailure } from "@/lib/ipc/electron-invoke-error";
import type { MaskLayer } from "@/lib/masks/mask-layer";
import { encodeMaskValuesAsGrayscalePngBytes } from "@/lib/masks/mask-png-encode";
import {
  MASK_SIDECAR_FILE_EXTENSION,
  serializeMaskSidecarDocument,
} from "@/lib/masks/mask-sidecar";

// CT-303: exporting a mask layer writes two files - the 8-bit PNG of category
// indexes and its JSON sidecar - through the SAME chunked save-image protocol
// every other export uses (CT-237). The sidecar rides the protocol's sidecar
// part, so main derives its path from the PNG the user chose and a failed or
// cancelled export leaves neither file behind.

export type MaskExportResult =
  | { readonly canceled: true }
  | { readonly canceled: false; readonly filePath: string };

const MASK_PNG_FILE_FILTER = { name: "PNG Image", extensions: ["png"] } as const;
const FALLBACK_MASK_FILE_STEM = "mask";

export async function exportMaskLayerThroughSaveDialog(
  layer: MaskLayer,
  api: SaveImageFlowApi = window.toolboxApi,
  chunkBytes: number = SAVE_IMAGE_CHUNK_BYTES,
): Promise<MaskExportResult> {
  const pngBytes = await encodeMaskValuesAsGrayscalePngBytes(
    layer.width,
    layer.height,
    layer.values,
  );
  const sidecarBytes = new TextEncoder().encode(serializeMaskSidecarDocument(layer));
  const begun = await api.beginSaveImage(buildMaskSaveBeginRequest(layer, pngBytes, sidecarBytes));
  if (begun.status === "canceled") return { canceled: true };
  return uploadMaskFilesAndFinish(api, begun.token, { pngBytes, sidecarBytes }, chunkBytes);
}

function buildMaskSaveBeginRequest(
  layer: MaskLayer,
  pngBytes: Uint8Array,
  sidecarBytes: Uint8Array,
): ToolboxSaveImageBeginRequest {
  return {
    suggestedFileName: buildSuggestedMaskFileName(layer.name),
    fileFilter: MASK_PNG_FILE_FILTER,
    primaryByteLength: pngBytes.byteLength,
    sidecar: {
      extension: MASK_SIDECAR_FILE_EXTENSION,
      byteLength: sidecarBytes.byteLength,
    },
  };
}

export function buildSuggestedMaskFileName(layerName: string): string {
  return `${sanitizeExportBaseName(layerName, FALLBACK_MASK_FILE_STEM)}.png`;
}

interface MaskExportFileBytes {
  readonly pngBytes: Uint8Array;
  readonly sidecarBytes: Uint8Array;
}

async function uploadMaskFilesAndFinish(
  api: SaveImageFlowApi,
  token: string,
  files: MaskExportFileBytes,
  chunkBytes: number,
): Promise<MaskExportResult> {
  try {
    await uploadOnePartInChunks(api, token, "primary", files.pngBytes, chunkBytes);
    await uploadOnePartInChunks(api, token, "sidecar", files.sidecarBytes, chunkBytes);
    const finished = await api.finishSaveImage({ token });
    return { canceled: false, filePath: finished.filePath };
  } catch (error) {
    await api.releaseSaveImage({ token }).catch(() => undefined);
    throw new Error(describeElectronInvokeFailure(error));
  }
}

async function uploadOnePartInChunks(
  api: SaveImageFlowApi,
  token: string,
  part: ToolboxSaveImagePart,
  bytes: Uint8Array,
  chunkBytes: number,
): Promise<void> {
  await emitBufferInBoundedSlicesInOrder(bytes, chunkBytes, (chunk) =>
    api.sendSaveImageChunk({ token, part, bytes: chunk }),
  );
}
