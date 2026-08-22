import { SAVE_BUNDLE_CHUNK_BYTES } from "@shared/chunked-save-bundle-protocol";

import { holdSourcesBuffersWhileInUse } from "@/lib/image/raster-buffer-release";
import { describeElectronInvokeFailure } from "@/lib/ipc/electron-invoke-error";

import { PROJECT_FILE_FORMAT_VERSION } from "./project-schema";
import {
  buildDraftBundleViewportEntryOrThrow,
  type DraftBundleFile,
  type DraftBundleViewportEntry,
  type SaveableProjectSnapshot,
} from "./serialize-project";
import {
  splitDraftBundleForChunkedSave,
  type SaveBundleUploadPart,
} from "./split-draft-bundle";

// CT-219e: drives the chunked project-save protocol from the renderer. The old
// single window.toolboxApi.saveProjectBundleDialog invoke carried the whole
// BundleDraft, baked asset bytes included (~1.5 GB for a modified
// reference-scale stack), and V8's ValueSerializer killed the renderer process
// while serializing it - the save died with no toast, no error, and no file.
// This orchestrator sends a byte-free header first (resolving the save dialog
// before any bytes move), then encodes and uploads each baked asset chunk by
// chunk (CT-235: the encode itself is chunked too, so no whole-asset buffer
// ever exists in the renderer), and finishes with the zip write in main. No
// invoke ever approaches the danger zone and the awaits between chunks keep
// the renderer interactive. The api is injected so the sequencing is
// unit-testable without the bridge.

// Draft/plan building fills 0..0.25 of the bar, the chunked encode-and-upload
// 0.25..0.95, and the zip write in main completes to 1 when finish resolves.
const BAKE_PROGRESS_WINDOW_END = 0.25;
const UPLOAD_PROGRESS_WINDOW_END = 0.95;

export interface SaveBundleFlowProgressEvent {
  readonly fraction: number;
}

export interface SaveBundleFlowInput {
  readonly snapshot: SaveableProjectSnapshot;
  readonly currentProjectFilePath: string | null;
  readonly saveAs: boolean;
  readonly onProgress?: (event: SaveBundleFlowProgressEvent) => void;
}

export type SaveBundleFlowResult =
  | { canceled: true }
  | { canceled: false; filePath: string };

export interface SaveBundleFlowApi {
  beginSaveProjectBundle(
    request: ToolboxSaveBundleBeginRequest,
  ): Promise<ToolboxSaveBundleBeginResult>;
  sendSaveProjectBundleAssetChunk(
    request: ToolboxSaveBundleAssetChunkRequest,
  ): Promise<void>;
  finishSaveProjectBundle(
    request: ToolboxSaveBundleFinishRequest,
  ): Promise<ToolboxSaveBundleFinishResult>;
  releaseSaveProjectBundle(request: ToolboxSaveBundleReleaseRequest): Promise<void>;
}

// CT-290: every snapshotted source is held for the save's duration so an apply
// that replaces a panel mid-save cannot detach the buffers being baked.
export async function runSaveProjectBundleFlowThroughMainProcess(
  input: SaveBundleFlowInput,
  api: SaveBundleFlowApi = window.toolboxApi,
  chunkBytes: number = SAVE_BUNDLE_CHUNK_BYTES,
): Promise<SaveBundleFlowResult> {
  const releaseSourceHolds = holdSourcesBuffersWhileInUse(
    input.snapshot.viewports.map((viewport) => viewport.source),
  );
  try {
    return await runSaveBundleFlowWhileSourcesAreHeld(input, api, chunkBytes);
  } finally {
    releaseSourceHolds();
  }
}

async function runSaveBundleFlowWhileSourcesAreHeld(
  input: SaveBundleFlowInput,
  api: SaveBundleFlowApi,
  chunkBytes: number,
): Promise<SaveBundleFlowResult> {
  const draft = await buildDraftBundleWithIncrementalProgressReporting(
    input.snapshot,
    input.onProgress,
  );
  const { header, parts } = splitDraftBundleForChunkedSave(draft);
  const begun = await api.beginSaveProjectBundle({
    header,
    currentProjectFilePath: input.currentProjectFilePath,
    saveAs: input.saveAs,
  });
  if (begun.status === "canceled") return { canceled: true };
  return transferPartsAndFinishSave(api, begun.token, parts, chunkBytes, input.onProgress);
}

async function transferPartsAndFinishSave(
  api: SaveBundleFlowApi,
  token: string,
  parts: ReadonlyArray<SaveBundleUploadPart>,
  chunkBytes: number,
  onProgress: SaveBundleFlowInput["onProgress"],
): Promise<SaveBundleFlowResult> {
  try {
    await uploadBakedAssetPartsInChunks(api, token, parts, chunkBytes, onProgress);
    const finished = await api.finishSaveProjectBundle({ token });
    onProgress?.({ fraction: 1 });
    return { canceled: false, filePath: finished.filePath };
  } catch (error) {
    await api.releaseSaveProjectBundle({ token }).catch(() => undefined);
    throw new Error(describeElectronInvokeFailure(error));
  }
}

async function uploadBakedAssetPartsInChunks(
  api: SaveBundleFlowApi,
  token: string,
  parts: ReadonlyArray<SaveBundleUploadPart>,
  chunkBytes: number,
  onProgress: SaveBundleFlowInput["onProgress"],
): Promise<void> {
  const totalBytes = parts.reduce((sum, part) => sum + part.plan.byteLength, 0);
  let sentBytes = 0;
  for (const part of parts) {
    sentBytes = await encodeAndUploadOnePartInChunks(api, token, part, chunkBytes, sentBytes, totalBytes, onProgress);
  }
  onProgress?.({ fraction: UPLOAD_PROGRESS_WINDOW_END });
}

// Each chunk is encoded on demand and its upload awaited before the next chunk
// is built (CT-235), so renderer memory holds one chunk at a time per asset and
// the awaits double as paint yields.
async function encodeAndUploadOnePartInChunks(
  api: SaveBundleFlowApi,
  token: string,
  part: SaveBundleUploadPart,
  chunkBytes: number,
  sentBytes: number,
  totalBytes: number,
  onProgress: SaveBundleFlowInput["onProgress"],
): Promise<number> {
  let sent = sentBytes;
  await part.plan.emitChunksInOrder(chunkBytes, async (chunk) => {
    await api.sendSaveProjectBundleAssetChunk({ token, viewportIndex: part.viewportIndex, part: part.part, bytes: chunk });
    sent += chunk.byteLength;
    onProgress?.({ fraction: uploadWindowFraction(sent, totalBytes) });
  });
  return sent;
}

function uploadWindowFraction(sentBytes: number, totalBytes: number): number {
  if (totalBytes === 0) return UPLOAD_PROGRESS_WINDOW_END;
  const uploadSpan = UPLOAD_PROGRESS_WINDOW_END - BAKE_PROGRESS_WINDOW_END;
  return BAKE_PROGRESS_WINDOW_END + (sentBytes / totalBytes) * uploadSpan;
}

async function buildDraftBundleWithIncrementalProgressReporting(
  snapshot: SaveableProjectSnapshot,
  onProgress: SaveBundleFlowInput["onProgress"],
): Promise<DraftBundleFile> {
  const viewports = await bakeViewportEntriesWithProgress(snapshot, onProgress);
  return {
    formatVersion: PROJECT_FILE_FORMAT_VERSION,
    gridLayout: snapshot.gridLayout,
    selectedViewportIndices: [...snapshot.selectedViewportIndices].sort((a, b) => a - b),
    viewports,
  };
}

async function bakeViewportEntriesWithProgress(
  snapshot: SaveableProjectSnapshot,
  onProgress: SaveBundleFlowInput["onProgress"],
): Promise<ReadonlyArray<DraftBundleViewportEntry>> {
  const totalAssetCount = snapshot.viewports.length;
  onProgress?.({ fraction: 0 });
  const baked: DraftBundleViewportEntry[] = [];
  for (let viewportPosition = 0; viewportPosition < totalAssetCount; viewportPosition++) {
    baked.push(buildDraftBundleViewportEntryOrThrow(snapshot.viewports[viewportPosition]!));
    onProgress?.({ fraction: bakeWindowFraction(viewportPosition + 1, totalAssetCount) });
    await yieldToMicrotaskQueue();
  }
  return baked;
}

function bakeWindowFraction(bakedAssetCount: number, totalAssetCount: number): number {
  if (totalAssetCount === 0) return BAKE_PROGRESS_WINDOW_END;
  return (bakedAssetCount / totalAssetCount) * BAKE_PROGRESS_WINDOW_END;
}

function yieldToMicrotaskQueue(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
