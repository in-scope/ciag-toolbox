import { SAVE_IMAGE_CHUNK_BYTES } from "@shared/chunked-save-image-protocol";

import { emitBufferInBoundedSlicesInOrder } from "@/lib/image/emit-byte-chunks";
import type { SaveImageFlowApi } from "@/lib/image/run-save-image-flow";
import { describeElectronInvokeFailure } from "@/lib/ipc/electron-invoke-error";
import {
  buildMaskLayerFileStem,
  buildMaskLayerZipBytes,
  MASK_EXPORT_FILE_EXTENSION,
} from "@/lib/masks/mask-export-zip";
import type { MaskLayer } from "@/lib/masks/mask-layer";

// CT-303/CT-327: exporting a mask layer writes ONE zip - the per-category
// black-and-white PNGs plus the index PNG and its JSON sidecar - through the
// SAME chunked save-image protocol every other export uses (CT-237). The
// archive is the protocol's PRIMARY part and there is no sidecar part any
// more (the JSON lives inside the zip), so a failed or cancelled export leaves
// no file behind and no new IPC channel exists.

export type MaskExportResult =
  | { readonly canceled: true }
  | { readonly canceled: false; readonly filePath: string };

const MASK_ZIP_FILE_FILTER = {
  name: "Zip archive",
  extensions: [MASK_EXPORT_FILE_EXTENSION],
} as const;

export async function exportMaskLayerThroughSaveDialog(
  layer: MaskLayer,
  api: SaveImageFlowApi = window.toolboxApi,
  chunkBytes: number = SAVE_IMAGE_CHUNK_BYTES,
): Promise<MaskExportResult> {
  const zipBytes = await buildMaskLayerZipBytes(layer);
  const begun = await api.beginSaveImage(buildMaskSaveBeginRequest(layer, zipBytes));
  if (begun.status === "canceled") return { canceled: true };
  return uploadMaskZipAndFinish(api, begun.token, zipBytes, chunkBytes);
}

function buildMaskSaveBeginRequest(
  layer: MaskLayer,
  zipBytes: Uint8Array,
): ToolboxSaveImageBeginRequest {
  return {
    suggestedFileName: buildSuggestedMaskFileName(layer.name),
    fileFilter: MASK_ZIP_FILE_FILTER,
    primaryByteLength: zipBytes.byteLength,
  };
}

export function buildSuggestedMaskFileName(layerName: string): string {
  return `${buildMaskLayerFileStem(layerName)}.${MASK_EXPORT_FILE_EXTENSION}`;
}

async function uploadMaskZipAndFinish(
  api: SaveImageFlowApi,
  token: string,
  zipBytes: Uint8Array,
  chunkBytes: number,
): Promise<MaskExportResult> {
  try {
    await uploadPrimaryPartInChunks(api, token, zipBytes, chunkBytes);
    const finished = await api.finishSaveImage({ token });
    return { canceled: false, filePath: finished.filePath };
  } catch (error) {
    await api.releaseSaveImage({ token }).catch(() => undefined);
    throw new Error(describeElectronInvokeFailure(error));
  }
}

async function uploadPrimaryPartInChunks(
  api: SaveImageFlowApi,
  token: string,
  bytes: Uint8Array,
  chunkBytes: number,
): Promise<void> {
  await emitBufferInBoundedSlicesInOrder(bytes, chunkBytes, (chunk) =>
    api.sendSaveImageChunk({ token, part: "primary", bytes: chunk }),
  );
}
