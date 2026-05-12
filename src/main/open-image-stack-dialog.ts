import { BrowserWindow, dialog, ipcMain } from "electron";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

import { computeSha256HexFromBytes } from "./content-hash";

const OPEN_IMAGE_STACK_DIALOG_CHANNEL = "image:open-stack-dialog";
const OPEN_IMAGE_STACK_PROGRESS_CHANNEL = "image:open-stack-progress";

const TIFF_STACK_FILE_FILTER: Electron.FileFilter = {
  name: "TIFF images",
  extensions: ["tif", "tiff"],
};

export interface OpenImageStackFileEntry {
  fileName: string;
  filePath: string;
  bytes: Uint8Array;
  contentHash: string;
  fileSizeBytes: number;
  mtimeMs: number;
}

export interface OpenImageStackProgressEvent {
  fileIndex: number;
  totalCount: number;
  fileName: string;
}

export type OpenImageStackDialogResult =
  | { canceled: true }
  | { canceled: false; files: ReadonlyArray<OpenImageStackFileEntry> };

async function showImageStackOpenDialog(
  window: BrowserWindow,
): Promise<Electron.OpenDialogReturnValue> {
  return dialog.showOpenDialog(window, {
    title: "Open Image Stack",
    properties: ["openFile", "multiSelections"],
    filters: [TIFF_STACK_FILE_FILTER],
  });
}

async function readSingleStackEntryFromPath(
  filePath: string,
): Promise<OpenImageStackFileEntry> {
  const [buffer, stats] = await Promise.all([readFile(filePath), stat(filePath)]);
  const bytes = new Uint8Array(buffer);
  return {
    fileName: basename(filePath),
    filePath,
    bytes,
    contentHash: computeSha256HexFromBytes(bytes),
    fileSizeBytes: bytes.length,
    mtimeMs: stats.mtimeMs,
  };
}

function sendStackProgressToRenderer(
  window: BrowserWindow,
  event: OpenImageStackProgressEvent,
): void {
  if (window.isDestroyed()) return;
  window.webContents.send(OPEN_IMAGE_STACK_PROGRESS_CHANNEL, event);
}

async function readAllStackEntriesWithProgress(
  window: BrowserWindow,
  filePaths: ReadonlyArray<string>,
): Promise<ReadonlyArray<OpenImageStackFileEntry>> {
  const entries: OpenImageStackFileEntry[] = [];
  for (let index = 0; index < filePaths.length; index++) {
    const entry = await readNextStackEntryAndReportProgress(window, filePaths, index);
    entries.push(entry);
  }
  return entries;
}

async function readNextStackEntryAndReportProgress(
  window: BrowserWindow,
  filePaths: ReadonlyArray<string>,
  index: number,
): Promise<OpenImageStackFileEntry> {
  const filePath = filePaths[index];
  if (filePath === undefined) {
    throw new Error("Internal error: missing file path during stack read");
  }
  const entry = await readSingleStackEntryFromPath(filePath);
  sendStackProgressToRenderer(window, {
    fileIndex: index + 1,
    totalCount: filePaths.length,
    fileName: entry.fileName,
  });
  return entry;
}

async function chooseAndReadStackFromDialog(
  window: BrowserWindow,
): Promise<OpenImageStackDialogResult> {
  const dialogResult = await showImageStackOpenDialog(window);
  if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
    return { canceled: true };
  }
  const files = await readAllStackEntriesWithProgress(window, dialogResult.filePaths);
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
  return chooseAndReadStackFromDialog(window);
}

export function registerOpenImageStackDialogIpcHandler(): void {
  ipcMain.handle(OPEN_IMAGE_STACK_DIALOG_CHANNEL, handleOpenImageStackDialogIpc);
}
