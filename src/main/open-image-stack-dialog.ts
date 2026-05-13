import { BrowserWindow, dialog, ipcMain } from "electron";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

const OPEN_IMAGE_STACK_DIALOG_CHANNEL = "image:open-stack-dialog";
const OPEN_IMAGE_STACK_READ_FILE_CHANNEL = "image:open-stack-read-file";

const TIFF_STACK_FILE_FILTER: Electron.FileFilter = {
  name: "TIFF images",
  extensions: ["tif", "tiff"],
};

export interface OpenImageStackFileMetadata {
  fileName: string;
  filePath: string;
  fileSizeBytes: number;
  mtimeMs: number;
}

export type OpenImageStackDialogResult =
  | { canceled: true }
  | { canceled: false; files: ReadonlyArray<OpenImageStackFileMetadata> };

async function showImageStackOpenDialog(
  window: BrowserWindow,
): Promise<Electron.OpenDialogReturnValue> {
  return dialog.showOpenDialog(window, {
    title: "Open Image Stack",
    properties: ["openFile", "multiSelections"],
    filters: [TIFF_STACK_FILE_FILTER],
  });
}

async function readFileMetadataFromPath(
  filePath: string,
): Promise<OpenImageStackFileMetadata> {
  const stats = await stat(filePath);
  return {
    fileName: basename(filePath),
    filePath,
    fileSizeBytes: stats.size,
    mtimeMs: stats.mtimeMs,
  };
}

async function collectMetadataForSelectedPaths(
  filePaths: ReadonlyArray<string>,
): Promise<ReadonlyArray<OpenImageStackFileMetadata>> {
  return Promise.all(filePaths.map(readFileMetadataFromPath));
}

async function chooseStackPathsAndReturnMetadata(
  window: BrowserWindow,
): Promise<OpenImageStackDialogResult> {
  const dialogResult = await showImageStackOpenDialog(window);
  if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
    return { canceled: true };
  }
  const files = await collectMetadataForSelectedPaths(dialogResult.filePaths);
  return { canceled: false, files };
}

function findWindowForIpcEvent(
  event: Electron.IpcMainInvokeEvent,
): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

async function handleOpenImageStackDialogIpc(
  event: Electron.IpcMainInvokeEvent,
): Promise<OpenImageStackDialogResult> {
  const window = findWindowForIpcEvent(event);
  if (!window) return { canceled: true };
  return chooseStackPathsAndReturnMetadata(window);
}

async function handleReadImageStackFileIpc(
  _event: Electron.IpcMainInvokeEvent,
  filePath: string,
): Promise<Uint8Array> {
  const buffer = await readFile(filePath);
  return new Uint8Array(buffer);
}

export function registerOpenImageStackDialogIpcHandler(): void {
  ipcMain.handle(OPEN_IMAGE_STACK_DIALOG_CHANNEL, handleOpenImageStackDialogIpc);
  ipcMain.handle(OPEN_IMAGE_STACK_READ_FILE_CHANNEL, handleReadImageStackFileIpc);
}
