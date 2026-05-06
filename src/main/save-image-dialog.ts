import { BrowserWindow, dialog, ipcMain } from "electron";
import { unlink, writeFile } from "node:fs/promises";
import { extname } from "node:path";

export interface SaveImageDialogSidecar {
  readonly extension: string;
  readonly bytes: Uint8Array;
}

export interface SaveImageDialogRequest {
  readonly suggestedFileName: string;
  readonly bytes: Uint8Array;
  readonly fileFilter: { readonly name: string; readonly extensions: ReadonlyArray<string> };
  readonly sidecar?: SaveImageDialogSidecar;
}

export type SaveImageDialogResult =
  | { canceled: true }
  | { canceled: false; filePath: string };

const SAVE_IMAGE_DIALOG_CHANNEL = "image:save-dialog";

async function showImageSaveDialog(
  window: BrowserWindow,
  request: SaveImageDialogRequest,
): Promise<Electron.SaveDialogReturnValue> {
  return dialog.showSaveDialog(window, {
    title: "Save Image",
    defaultPath: request.suggestedFileName,
    filters: [{ name: request.fileFilter.name, extensions: [...request.fileFilter.extensions] }],
  });
}

async function writeImageBytesToChosenPath(
  filePath: string,
  bytes: Uint8Array,
): Promise<void> {
  await writeFile(filePath, bytes);
}

async function writeSidecarFileNextToPrimary(
  primaryFilePath: string,
  sidecar: SaveImageDialogSidecar,
): Promise<string> {
  const sidecarPath = buildSidecarPathFromPrimary(primaryFilePath, sidecar.extension);
  await writeFile(sidecarPath, sidecar.bytes);
  return sidecarPath;
}

function buildSidecarPathFromPrimary(
  primaryFilePath: string,
  sidecarExtension: string,
): string {
  const existingExtension = extname(primaryFilePath);
  const stem = primaryFilePath.slice(0, primaryFilePath.length - existingExtension.length);
  return `${stem}.${sidecarExtension}`;
}

async function writePrimaryAndSidecarAtomically(
  primaryFilePath: string,
  request: SaveImageDialogRequest,
): Promise<void> {
  await writeImageBytesToChosenPath(primaryFilePath, request.bytes);
  if (!request.sidecar) return;
  await writeSidecarOrRollbackPrimary(primaryFilePath, request.sidecar);
}

async function writeSidecarOrRollbackPrimary(
  primaryFilePath: string,
  sidecar: SaveImageDialogSidecar,
): Promise<void> {
  try {
    await writeSidecarFileNextToPrimary(primaryFilePath, sidecar);
  } catch (error) {
    await tryRemoveFileIgnoringErrors(primaryFilePath);
    throw error;
  }
}

async function tryRemoveFileIgnoringErrors(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // best-effort rollback; primary may already be gone
  }
}

async function chooseAndWriteImageToDisk(
  window: BrowserWindow,
  request: SaveImageDialogRequest,
): Promise<SaveImageDialogResult> {
  const dialogResult = await showImageSaveDialog(window, request);
  if (dialogResult.canceled || !dialogResult.filePath) {
    return { canceled: true };
  }
  await writePrimaryAndSidecarAtomically(dialogResult.filePath, request);
  return { canceled: false, filePath: dialogResult.filePath };
}

function findWindowForIpcEvent(
  event: Electron.IpcMainInvokeEvent,
): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

async function handleSaveImageDialogIpc(
  event: Electron.IpcMainInvokeEvent,
  request: SaveImageDialogRequest,
): Promise<SaveImageDialogResult> {
  const window = findWindowForIpcEvent(event);
  if (!window) return { canceled: true };
  return chooseAndWriteImageToDisk(window, request);
}

export function registerSaveImageDialogIpcHandler(): void {
  ipcMain.handle(SAVE_IMAGE_DIALOG_CHANNEL, handleSaveImageDialogIpc);
}
