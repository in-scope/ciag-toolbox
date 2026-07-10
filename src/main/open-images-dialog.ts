import { BrowserWindow, ipcMain } from "electron";
import { stat } from "node:fs/promises";
import { basename } from "node:path";

import { showOpenDialogOrStub } from "./e2e-dialog-stub";

const OPEN_IMAGES_DIALOG_CHANNEL = "image:open-images-dialog";

const SUPPORTED_IMAGE_FILTER: Electron.FileFilter = {
  name: "Images",
  extensions: [
    "png",
    "jpg",
    "jpeg",
    "tif",
    "tiff",
    "hdr",
    "dng",
    "cr3",
    "arw",
    "nef",
    "raf",
    "orf",
    "pef",
    "rw2",
  ],
};

export interface OpenedImageFileMetadataEntry {
  fileName: string;
  filePath: string;
  fileSizeBytes: number;
  mtimeMs: number;
}

export type OpenImagesDialogResult =
  | { canceled: true }
  | { canceled: false; files: ReadonlyArray<OpenedImageFileMetadataEntry> };

async function showImagesOpenDialogAllowingMultiSelect(
  window: BrowserWindow,
): Promise<Electron.OpenDialogReturnValue> {
  return showOpenDialogOrStub(window, {
    title: "Open Images",
    properties: ["openFile", "multiSelections"],
    filters: [SUPPORTED_IMAGE_FILTER],
  });
}

async function readFileMetadataForOpenedImagePath(
  filePath: string,
): Promise<OpenedImageFileMetadataEntry> {
  const stats = await stat(filePath);
  return {
    fileName: basename(filePath),
    filePath,
    fileSizeBytes: stats.size,
    mtimeMs: stats.mtimeMs,
  };
}

async function collectMetadataForAllSelectedImagePaths(
  filePaths: ReadonlyArray<string>,
): Promise<ReadonlyArray<OpenedImageFileMetadataEntry>> {
  return Promise.all(filePaths.map(readFileMetadataForOpenedImagePath));
}

async function chooseImagePathsAndCollectMetadata(
  window: BrowserWindow,
): Promise<OpenImagesDialogResult> {
  const dialogResult = await showImagesOpenDialogAllowingMultiSelect(window);
  if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
    return { canceled: true };
  }
  const files = await collectMetadataForAllSelectedImagePaths(dialogResult.filePaths);
  return { canceled: false, files };
}

function findWindowForIpcEvent(
  event: Electron.IpcMainInvokeEvent,
): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

async function handleOpenImagesDialogIpc(
  event: Electron.IpcMainInvokeEvent,
): Promise<OpenImagesDialogResult> {
  const window = findWindowForIpcEvent(event);
  if (!window) return { canceled: true };
  return chooseImagePathsAndCollectMetadata(window);
}

// CT-219b: the old "image:open-images-read-file" handler that returned the
// WHOLE file's bytes in one reply lived here; it killed the main process for
// files of roughly 1 GiB and above (serializer growth past the PartitionAlloc
// 2 GiB allocation cap). File bytes now stream through the chunked protocol in
// chunked-opened-image-read-ipc.ts instead.
export function registerOpenImagesDialogIpcHandlers(): void {
  ipcMain.handle(OPEN_IMAGES_DIALOG_CHANNEL, handleOpenImagesDialogIpc);
}
