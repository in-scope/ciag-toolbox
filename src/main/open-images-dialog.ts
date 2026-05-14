import { BrowserWindow, dialog, ipcMain } from "electron";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

import { computeSha256HexFromBytes } from "./content-hash";

const OPEN_IMAGES_DIALOG_CHANNEL = "image:open-images-dialog";
const OPEN_IMAGES_READ_FILE_CHANNEL = "image:open-images-read-file";

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

export interface OpenedImageFileSidecar {
  fileName: string;
  bytes: Uint8Array;
}

export interface OpenedImageFileMetadataEntry {
  fileName: string;
  filePath: string;
  fileSizeBytes: number;
  mtimeMs: number;
}

export interface OpenedImageFileEntry {
  fileName: string;
  filePath: string;
  bytes: Uint8Array;
  contentHash: string;
  fileSizeBytes: number;
  mtimeMs: number;
  sidecar?: OpenedImageFileSidecar;
}

export type OpenImagesDialogResult =
  | { canceled: true }
  | { canceled: false; files: ReadonlyArray<OpenedImageFileMetadataEntry> };

async function showImagesOpenDialogAllowingMultiSelect(
  window: BrowserWindow,
): Promise<Electron.OpenDialogReturnValue> {
  return dialog.showOpenDialog(window, {
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

async function readBytesAtPathAsUint8Array(filePath: string): Promise<Uint8Array> {
  const buffer = await readFile(filePath);
  return new Uint8Array(buffer);
}

async function findEnviSidecarForOpenedImageFile(
  filePath: string,
): Promise<OpenedImageFileSidecar | undefined> {
  if (!isEnviHeaderFilePath(filePath)) return undefined;
  return loadEnviBinarySiblingOrThrow(filePath);
}

function isEnviHeaderFilePath(filePath: string): boolean {
  return extname(filePath).toLowerCase() === ENVI_HEADER_EXTENSION;
}

async function loadEnviBinarySiblingOrThrow(
  headerPath: string,
): Promise<OpenedImageFileSidecar> {
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
    bytes: await readBytesAtPathAsUint8Array(siblingPath),
  };
}

function pickEnviBinarySiblingFromDirectoryEntries(
  headerPath: string,
  directoryEntries: ReadonlyArray<string>,
): string | undefined {
  const headerBaseName = basename(headerPath, extname(headerPath));
  const headerBaseNameLower = headerBaseName.toLowerCase();
  for (const candidate of ENVI_BINARY_EXTENSION_CANDIDATES) {
    const match = directoryEntries.find((entry) =>
      entryMatchesBaseNameAndExtension(entry, headerBaseNameLower, candidate),
    );
    if (match) return match;
  }
  return undefined;
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

async function buildOpenedImageFileEntryFromMetadata(
  metadata: OpenedImageFileMetadataEntry,
): Promise<OpenedImageFileEntry> {
  const bytes = await readBytesAtPathAsUint8Array(metadata.filePath);
  const contentHash = computeSha256HexFromBytes(bytes);
  const sidecar = await findEnviSidecarForOpenedImageFile(metadata.filePath);
  return {
    fileName: metadata.fileName,
    filePath: metadata.filePath,
    bytes,
    contentHash,
    fileSizeBytes: metadata.fileSizeBytes,
    mtimeMs: metadata.mtimeMs,
    ...(sidecar ? { sidecar } : {}),
  };
}

async function handleReadOpenedImageFileIpc(
  _event: Electron.IpcMainInvokeEvent,
  metadata: OpenedImageFileMetadataEntry,
): Promise<OpenedImageFileEntry> {
  return buildOpenedImageFileEntryFromMetadata(metadata);
}

export function registerOpenImagesDialogIpcHandlers(): void {
  ipcMain.handle(OPEN_IMAGES_DIALOG_CHANNEL, handleOpenImagesDialogIpc);
  ipcMain.handle(OPEN_IMAGES_READ_FILE_CHANNEL, handleReadOpenedImageFileIpc);
}
