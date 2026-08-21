import {
  SAVE_IMAGE_CHUNK_BYTES,
  saveImageFolderFilePartName,
} from "@shared/chunked-save-image-protocol";

import { describeElectronInvokeFailure } from "@/lib/ipc/electron-invoke-error";

import {
  planViewportSourceSaveUpload,
  type SaveImageUploadPartPlan,
  type SaveImageUploadPlan,
} from "@/lib/image/encode-saved-image";
import {
  planPngStackExportUpload,
  type PngStackFileUploadPlan,
} from "@/lib/image/plan-png-stack-export";
import {
  findSaveImageFormatOptionOrThrow,
  isPngStackSaveFormat,
  type SaveImageFormatId,
} from "@/lib/image/save-image-formats";
import {
  findTiffExportRefusalMessageOrNull,
  TIFF_EXPORT_TOO_LARGE_MESSAGE,
} from "@/lib/image/tiff-export-size";
import { scaleProgressToWindow, type UnitProgressCallback } from "@/lib/image/unit-progress";
import type { ViewportImageSource } from "@/lib/webgl/texture";

// CT-237: drives the chunked save-image protocol from the renderer (the
// CT-219e orchestrator pattern; see src/shared/chunked-save-image-protocol.ts
// for why the old whole-payload invoke died at scale). TIFF exports whose
// image content cannot fit a classic TIFF are refused BEFORE any encoding
// starts. The api is injected so the sequencing is unit-testable without the
// bridge.

// TIFF/PNG/JPEG encodes fill 0..0.4 of the bar (ENVI plans instantly and skips
// it), the chunked upload 0.4..0.95 by bytes sent, and the finish write
// completes to 1.
const ENCODE_PROGRESS_WINDOW_END = 0.4;
const UPLOAD_PROGRESS_WINDOW_END = 0.95;

export interface SaveImageFlowInput {
  readonly source: ViewportImageSource;
  readonly selectedBandIndex: number;
  readonly originalFileName: string;
  readonly formatId: SaveImageFormatId;
  // CT-219f: drives the save busy entry's determinate bar.
  readonly onProgress?: UnitProgressCallback;
}

export type SaveImageFlowResult =
  | { canceled: true }
  | { canceled: false; filePath: string };

export interface SaveImageFlowApi {
  beginSaveImage(request: ToolboxSaveImageBeginRequest): Promise<ToolboxSaveImageBeginResult>;
  sendSaveImageChunk(request: ToolboxSaveImageChunkRequest): Promise<void>;
  finishSaveImage(request: ToolboxSaveImageFinishRequest): Promise<ToolboxSaveImageFinishResult>;
  releaseSaveImage(request: ToolboxSaveImageReleaseRequest): Promise<void>;
}

export async function runSaveImageFlowThroughMainProcess(
  input: SaveImageFlowInput,
  api: SaveImageFlowApi = window.toolboxApi,
  chunkBytes: number = SAVE_IMAGE_CHUNK_BYTES,
): Promise<SaveImageFlowResult> {
  if (isPngStackSaveFormat(input.formatId)) {
    return runPngStackFolderSaveFlow(input, api, chunkBytes);
  }
  refuseTiffExportBeyondClassicTiffLimit(input.source, input.formatId);
  const upload = await planViewportSourceSaveUpload({
    source: input.source,
    selectedBandIndex: input.selectedBandIndex,
    formatId: input.formatId,
    onProgress: scaleProgressToWindow(input.onProgress, 0, ENCODE_PROGRESS_WINDOW_END),
  });
  const begun = await api.beginSaveImage(buildSaveImageBeginRequest(input, upload));
  if (begun.status === "canceled") return { canceled: true };
  return uploadPartsAndFinishSave(api, begun.token, upload, chunkBytes, input.onProgress);
}

// CT-273: the PNG stack export writes one file per band into a folder the
// user picks at begin time. Chunks upload per band file (determinate per-band
// progress by bytes), and finish reports the destination folder.
async function runPngStackFolderSaveFlow(
  input: SaveImageFlowInput,
  api: SaveImageFlowApi,
  chunkBytes: number,
): Promise<SaveImageFlowResult> {
  const files = await planPngStackExportUpload({
    source: input.source,
    originalFileName: input.originalFileName,
    formatId: input.formatId,
    onProgress: scaleProgressToWindow(input.onProgress, 0, ENCODE_PROGRESS_WINDOW_END),
  });
  const begun = await api.beginSaveImage(buildPngStackFolderBeginRequest(files));
  if (begun.status === "canceled") return { canceled: true };
  return uploadFolderFilesAndFinishSave(api, begun.token, files, chunkBytes, input.onProgress);
}

function buildPngStackFolderBeginRequest(
  files: ReadonlyArray<PngStackFileUploadPlan>,
): ToolboxSaveImageBeginRequest {
  return {
    destination: "folder",
    files: files.map((file) => ({
      fileName: file.fileName,
      byteLength: file.plan.byteLength,
      ...(file.encoding ? { encoding: file.encoding } : {}),
    })),
  };
}

async function uploadFolderFilesAndFinishSave(
  api: SaveImageFlowApi,
  token: string,
  files: ReadonlyArray<PngStackFileUploadPlan>,
  chunkBytes: number,
  onProgress: UnitProgressCallback | undefined,
): Promise<SaveImageFlowResult> {
  try {
    await uploadFolderFilesInChunks(api, token, files, chunkBytes, onProgress);
    const finished = await api.finishSaveImage({ token });
    onProgress?.(1);
    return { canceled: false, filePath: finished.filePath };
  } catch (error) {
    await api.releaseSaveImage({ token }).catch(() => undefined);
    throw new Error(describeElectronInvokeFailure(error));
  }
}

async function uploadFolderFilesInChunks(
  api: SaveImageFlowApi,
  token: string,
  files: ReadonlyArray<PngStackFileUploadPlan>,
  chunkBytes: number,
  onProgress: UnitProgressCallback | undefined,
): Promise<void> {
  const totalBytes = files.reduce((sum, file) => sum + file.plan.byteLength, 0);
  let sentBytes = 0;
  for (let index = 0; index < files.length; index += 1) {
    sentBytes = await uploadOnePartInChunks(
      api, token, saveImageFolderFilePartName(index), files[index]!.plan,
      chunkBytes, sentBytes, totalBytes, onProgress,
    );
  }
}

// The refusal happens before any encoding starts and before the save dialog
// shows, so no partial file can exist (CT-237).
function refuseTiffExportBeyondClassicTiffLimit(
  source: ViewportImageSource,
  formatId: SaveImageFormatId,
): void {
  const refusalMessage = findTiffExportRefusalMessageOrNull(source, formatId);
  if (refusalMessage !== null) throw new Error(refusalMessage);
}

// The refusal toast shows the locked copy alone; every other failure keeps the
// "Could not save" prefix.
export function buildSaveImageFailureToastText(
  originalFileName: string,
  describedError: string,
): string {
  if (describedError === TIFF_EXPORT_TOO_LARGE_MESSAGE) return describedError;
  return `Could not save ${originalFileName}: ${describedError}`;
}

function buildSaveImageBeginRequest(
  input: SaveImageFlowInput,
  upload: SaveImageUploadPlan,
): ToolboxSaveImageBeginRequest {
  const formatOption = findSaveImageFormatOptionOrThrow(input.formatId);
  return {
    suggestedFileName: buildSuggestedSavedFileName(input.originalFileName, formatOption.extension),
    fileFilter: formatOption.fileFilter,
    primaryByteLength: upload.primary.byteLength,
    ...(upload.primaryEncoding ? { primaryEncoding: upload.primaryEncoding } : {}),
    ...(upload.sidecar
      ? { sidecar: { extension: upload.sidecar.extension, byteLength: upload.sidecar.plan.byteLength } }
      : {}),
  };
}

async function uploadPartsAndFinishSave(
  api: SaveImageFlowApi,
  token: string,
  upload: SaveImageUploadPlan,
  chunkBytes: number,
  onProgress: UnitProgressCallback | undefined,
): Promise<SaveImageFlowResult> {
  try {
    await uploadAllPartsInChunks(api, token, upload, chunkBytes, onProgress);
    const finished = await api.finishSaveImage({ token });
    onProgress?.(1);
    return { canceled: false, filePath: finished.filePath };
  } catch (error) {
    await api.releaseSaveImage({ token }).catch(() => undefined);
    throw new Error(describeElectronInvokeFailure(error));
  }
}

async function uploadAllPartsInChunks(
  api: SaveImageFlowApi,
  token: string,
  upload: SaveImageUploadPlan,
  chunkBytes: number,
  onProgress: UnitProgressCallback | undefined,
): Promise<void> {
  const totalBytes = upload.primary.byteLength + (upload.sidecar?.plan.byteLength ?? 0);
  const sentBytes = await uploadOnePartInChunks(
    api, token, "primary", upload.primary, chunkBytes, 0, totalBytes, onProgress,
  );
  if (!upload.sidecar) return;
  await uploadOnePartInChunks(
    api, token, "sidecar", upload.sidecar.plan, chunkBytes, sentBytes, totalBytes, onProgress,
  );
}

// Each chunk is encoded on demand and its upload awaited before the next chunk
// is built (the CT-235 pattern), so renderer memory holds one chunk at a time
// and the awaits double as paint yields.
async function uploadOnePartInChunks(
  api: SaveImageFlowApi,
  token: string,
  part: ToolboxSaveImagePart,
  plan: SaveImageUploadPartPlan,
  chunkBytes: number,
  alreadySentBytes: number,
  totalBytes: number,
  onProgress: UnitProgressCallback | undefined,
): Promise<number> {
  let sent = alreadySentBytes;
  await plan.emitChunksInOrder(chunkBytes, async (chunk) => {
    await api.sendSaveImageChunk({ token, part, bytes: chunk });
    sent += chunk.byteLength;
    onProgress?.(uploadWindowFraction(sent, totalBytes));
  });
  return sent;
}

function uploadWindowFraction(sentBytes: number, totalBytes: number): number {
  if (totalBytes === 0) return UPLOAD_PROGRESS_WINDOW_END;
  const uploadSpan = UPLOAD_PROGRESS_WINDOW_END - ENCODE_PROGRESS_WINDOW_END;
  return ENCODE_PROGRESS_WINDOW_END + (sentBytes / totalBytes) * uploadSpan;
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
