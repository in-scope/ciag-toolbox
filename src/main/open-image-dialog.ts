import { BrowserWindow, dialog, ipcMain } from "electron";
import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

import { computeSha256HexFromBytes } from "./content-hash";

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

const ENVI_HEADER_EXTENSION = ".hdr";
const ENVI_BINARY_EXTENSION_CANDIDATES: ReadonlyArray<string> = [
  ".bin",
  ".dat",
  ".img",
  ".raw",
  "",
];

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
  return findEnviBinarySiblingOrThrow(filePath);
}

function isEnviHeaderFilePath(filePath: string): boolean {
  return extname(filePath).toLowerCase() === ENVI_HEADER_EXTENSION;
}

async function findEnviBinarySiblingOrThrow(
  headerPath: string,
): Promise<OpenImageSidecar> {
  const directoryEntries = await readdir(dirname(headerPath));
  const matchingEntry = pickEnviBinarySiblingFromDirectoryEntries(headerPath, directoryEntries);
  if (!matchingEntry) {
    throw new Error(
      `Could not find ENVI binary sibling for ${basename(headerPath)} (looked for .bin/.dat/.img/.raw or extensionless match)`,
    );
  }
  const siblingPath = join(dirname(headerPath), matchingEntry);
  return {
    fileName: matchingEntry,
    bytes: await readImageFileAsBytes(siblingPath),
  };
}

function pickEnviBinarySiblingFromDirectoryEntries(
  headerPath: string,
  directoryEntries: ReadonlyArray<string>,
): string | undefined {
  const headerBaseName = basename(headerPath, extname(headerPath));
  const headerBaseNameLower = headerBaseName.toLowerCase();
  for (const candidate of ENVI_BINARY_EXTENSION_CANDIDATES) {
    const match = pickFirstMatchingDirectoryEntry(
      directoryEntries,
      headerBaseNameLower,
      candidate,
    );
    if (match) return match;
  }
  return undefined;
}

function pickFirstMatchingDirectoryEntry(
  entries: ReadonlyArray<string>,
  baseNameLower: string,
  expectedExtensionLower: string,
): string | undefined {
  return entries.find((entry) =>
    entryMatchesBaseNameAndExtension(entry, baseNameLower, expectedExtensionLower),
  );
}

function entryMatchesBaseNameAndExtension(
  entry: string,
  baseNameLower: string,
  expectedExtensionLower: string,
): boolean {
  const entryLower = entry.toLowerCase();
  if (expectedExtensionLower === "") return entryLower === baseNameLower;
  return entryLower === baseNameLower + expectedExtensionLower;
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
