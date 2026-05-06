import { BrowserWindow, dialog, ipcMain } from "electron";
import { writeFile } from "node:fs/promises";

export interface SaveImageDialogRequest {
  readonly suggestedFileName: string;
  readonly bytes: Uint8Array;
  readonly fileFilter: { readonly name: string; readonly extensions: ReadonlyArray<string> };
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

async function chooseAndWriteImageToDisk(
  window: BrowserWindow,
  request: SaveImageDialogRequest,
): Promise<SaveImageDialogResult> {
  const dialogResult = await showImageSaveDialog(window, request);
  if (dialogResult.canceled || !dialogResult.filePath) {
    return { canceled: true };
  }
  await writeImageBytesToChosenPath(dialogResult.filePath, request.bytes);
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
