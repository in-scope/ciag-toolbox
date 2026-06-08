import { BrowserWindow, dialog, ipcMain } from "electron";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";

import { extractProjectBundleToFreshTempDirectory } from "./extract-project-bundle";
import { readFileWithinOpenableSizeLimitOrThrow } from "./openable-file-size-limit";

const OPEN_BUNDLE_DIALOG_CHANNEL = "project:open-bundle-dialog";
const READ_BUNDLE_ASSET_CHANNEL = "project:read-bundle-asset";

const ENVI_HEADER_EXTENSION = ".hdr";
const PROJECT_BUNDLE_EXTENSION = "ctbundle";
const BUNDLE_PROJECT_JSON_FILE_NAME = "project.json";

export type OpenBundleDialogResult =
  | { canceled: true }
  | { canceled: false; projectFilePath: string; bytes: Uint8Array };

export interface ReadBundleAssetRequest {
  readonly projectFilePath: string;
  readonly relativePath: string;
}

export interface ReadBundleAssetSidecar {
  readonly fileName: string;
  readonly bytes: Uint8Array;
}

export type ReadBundleAssetResult =
  | { kind: "missing"; relativePath: string }
  | {
      kind: "found";
      absolutePath: string;
      fileName: string;
      bytes: Uint8Array;
      sidecar?: ReadBundleAssetSidecar;
    };

async function showOpenBundleDialog(
  window: BrowserWindow,
): Promise<OpenBundleDialogResult> {
  const result = await dialog.showOpenDialog(window, {
    title: "Open Project",
    properties: ["openFile"],
    filters: [{ name: "Toolbox Project Bundle", extensions: [PROJECT_BUNDLE_EXTENSION] }],
  });
  const [firstPath] = result.filePaths;
  if (result.canceled || firstPath === undefined) return { canceled: true };
  return openProjectFromBundleAtPath(firstPath);
}

async function openProjectFromBundleAtPath(
  bundleFilePath: string,
): Promise<OpenBundleDialogResult> {
  const tempDir = await extractProjectBundleToFreshTempDirectory(bundleFilePath);
  const projectJsonPath = join(tempDir, BUNDLE_PROJECT_JSON_FILE_NAME);
  const bytes = await readFileAsBytes(projectJsonPath);
  return { canceled: false, projectFilePath: projectJsonPath, bytes };
}

async function readFileAsBytes(filePath: string): Promise<Uint8Array> {
  return readFileWithinOpenableSizeLimitOrThrow(filePath);
}

function resolveAbsolutePathFromProjectFile(
  projectFilePath: string,
  relativePath: string,
): string {
  if (isAbsolute(relativePath)) return relativePath;
  return resolve(dirname(projectFilePath), relativePath);
}

async function tryReadBundleAsset(
  request: ReadBundleAssetRequest,
): Promise<ReadBundleAssetResult> {
  const absolutePath = resolveAbsolutePathFromProjectFile(
    request.projectFilePath,
    request.relativePath,
  );
  try {
    return await readBundleAssetWithSidecar(absolutePath);
  } catch {
    return { kind: "missing", relativePath: request.relativePath };
  }
}

async function readBundleAssetWithSidecar(
  absolutePath: string,
): Promise<ReadBundleAssetResult> {
  const bytes = await readFileAsBytes(absolutePath);
  const sidecar = await findEnviBinarySidecarIfApplicable(absolutePath);
  return {
    kind: "found",
    absolutePath,
    fileName: basename(absolutePath),
    bytes,
    ...(sidecar ? { sidecar } : {}),
  };
}

async function findEnviBinarySidecarIfApplicable(
  filePath: string,
): Promise<ReadBundleAssetSidecar | undefined> {
  if (extname(filePath).toLowerCase() !== ENVI_HEADER_EXTENSION) return undefined;
  const expectedBinaryPath = swapHeaderExtensionForBinaryExtension(filePath);
  try {
    const bytes = await readFileAsBytes(expectedBinaryPath);
    return { fileName: basename(expectedBinaryPath), bytes };
  } catch {
    return undefined;
  }
}

function swapHeaderExtensionForBinaryExtension(headerPath: string): string {
  const dirPath = dirname(headerPath);
  const stem = basename(headerPath, extname(headerPath));
  return join(dirPath, `${stem}.bin`);
}

function findWindowForIpcEvent(
  event: Electron.IpcMainInvokeEvent,
): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

async function handleOpenBundleDialogIpc(
  event: Electron.IpcMainInvokeEvent,
): Promise<OpenBundleDialogResult> {
  const window = findWindowForIpcEvent(event);
  if (!window) return { canceled: true };
  return showOpenBundleDialog(window);
}

async function handleReadBundleAssetIpc(
  _event: Electron.IpcMainInvokeEvent,
  request: ReadBundleAssetRequest,
): Promise<ReadBundleAssetResult> {
  return tryReadBundleAsset(request);
}

export function registerOpenBundleDialogIpcHandlers(): void {
  ipcMain.handle(OPEN_BUNDLE_DIALOG_CHANNEL, handleOpenBundleDialogIpc);
  ipcMain.handle(READ_BUNDLE_ASSET_CHANNEL, handleReadBundleAssetIpc);
}
