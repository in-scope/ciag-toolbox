import { BrowserWindow, dialog, ipcMain } from "electron";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

export type OpenImageResult =
  | { canceled: true }
  | {
      canceled: false;
      filePath: string;
      fileName: string;
      bytes: Uint8Array;
    };

const OPEN_IMAGE_DIALOG_CHANNEL = "image:open-dialog";

const SUPPORTED_IMAGE_FILTER: Electron.FileFilter = {
  name: "Images",
  extensions: ["png", "jpg", "jpeg", "tif", "tiff"],
};

async function showImageOpenDialog(
  window: BrowserWindow,
): Promise<Electron.OpenDialogReturnValue> {
  return dialog.showOpenDialog(window, {
    title: "Open Image",
    properties: ["openFile"],
    filters: [SUPPORTED_IMAGE_FILTER],
  });
}

async function readImageFileAsBytes(filePath: string): Promise<Uint8Array> {
  const buffer = await readFile(filePath);
  return new Uint8Array(buffer);
}

async function buildOpenImageResultFromPath(
  filePath: string,
): Promise<OpenImageResult> {
  const bytes = await readImageFileAsBytes(filePath);
  return {
    canceled: false,
    filePath,
    fileName: basename(filePath),
    bytes,
  };
}

async function chooseAndReadImageFromDialog(
  window: BrowserWindow,
): Promise<OpenImageResult> {
  const dialogResult = await showImageOpenDialog(window);
  const [firstPath] = dialogResult.filePaths;
  if (dialogResult.canceled || firstPath === undefined) {
    return { canceled: true };
  }
  return buildOpenImageResultFromPath(firstPath);
}

function findWindowForIpcEvent(
  event: Electron.IpcMainInvokeEvent,
): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

async function handleOpenImageDialogIpc(
  event: Electron.IpcMainInvokeEvent,
): Promise<OpenImageResult> {
  const window = findWindowForIpcEvent(event);
  if (!window) return { canceled: true };
  return chooseAndReadImageFromDialog(window);
}

export function registerOpenImageDialogIpcHandler(): void {
  ipcMain.handle(OPEN_IMAGE_DIALOG_CHANNEL, handleOpenImageDialogIpc);
}
