import { BrowserWindow, dialog, ipcMain } from "electron";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { computeSha256HexFromBytes } from "./content-hash";
import {
  findEnviBinarySiblingPathOrNull,
  isEnviHeaderFilePath,
} from "./envi-binary-sibling";

export interface OpenImageSidecar {
  fileName: string;
  bytes: Uint8Array;
}

export type OpenImageResult =
  | { canceled: true }
  | {
      canceled: false;
      filePath: string;
      fileName: string;
      bytes: Uint8Array;
      contentHash: string;
      sidecar?: OpenImageSidecar;
    };

const OPEN_IMAGE_DIALOG_CHANNEL = "image:open-dialog";

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
  const contentHash = computeSha256HexFromBytes(bytes);
  const sidecar = await findSidecarForOpenedImageFile(filePath);
  return {
    canceled: false,
    filePath,
    fileName: basename(filePath),
    bytes,
    contentHash,
    ...(sidecar ? { sidecar } : {}),
  };
}

async function findSidecarForOpenedImageFile(
  filePath: string,
): Promise<OpenImageSidecar | undefined> {
  if (!isEnviHeaderFilePath(filePath)) return undefined;
  return readEnviBinarySiblingOrThrow(filePath);
}

async function readEnviBinarySiblingOrThrow(
  headerPath: string,
): Promise<OpenImageSidecar> {
  const siblingPath = await findEnviBinarySiblingPathOrNull(headerPath);
  if (!siblingPath) {
    throw new Error(
      `Could not find ENVI binary sibling for ${basename(headerPath)} (looked for .bin/.dat/.img/.raw or extensionless match)`,
    );
  }
  return {
    fileName: basename(siblingPath),
    bytes: await readImageFileAsBytes(siblingPath),
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
