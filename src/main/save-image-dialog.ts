import { BrowserWindow, ipcMain } from "electron";
import { extname } from "node:path";

import { createSaveImageSessionStore } from "./chunked-save-image";
import { showOpenDialogOrStub, showSaveDialogOrStub } from "./e2e-dialog-stub";
import {
  SAVE_IMAGE_BEGIN_CHANNEL,
  SAVE_IMAGE_CHUNK_CHANNEL,
  SAVE_IMAGE_FINISH_CHANNEL,
  SAVE_IMAGE_RELEASE_CHANNEL,
  isSaveImageFolderBeginRequest,
  type SaveImageBeginRequest,
  type SaveImageBeginResult,
  type SaveImageChunkRequest,
  type SaveImageFinishRequest,
  type SaveImageFinishResult,
  type SaveImageFolderBeginRequest,
  type SaveImageReleaseRequest,
  type SaveImageSingleFileBeginRequest,
} from "../shared/chunked-save-image-protocol";

// CT-237: the save-image export streams through the chunked protocol in
// src/shared/chunked-save-image-protocol.ts; the old whole-payload
// image:save-dialog invoke is gone. This module owns the save dialog and the
// channel registration; chunked-save-image.ts owns the transfer state.

const saveImageSessions = createSaveImageSessionStore();

async function showImageSaveDialog(
  window: BrowserWindow,
  request: SaveImageSingleFileBeginRequest,
): Promise<Electron.SaveDialogReturnValue> {
  return showSaveDialogOrStub(window, {
    title: "Save Image",
    defaultPath: request.suggestedFileName,
    filters: [{ name: request.fileFilter.name, extensions: [...request.fileFilter.extensions] }],
  });
}

function buildSidecarPathFromPrimary(
  primaryFilePath: string,
  sidecarExtension: string,
): string {
  const existingExtension = extname(primaryFilePath);
  const stem = primaryFilePath.slice(0, primaryFilePath.length - existingExtension.length);
  return `${stem}.${sidecarExtension}`;
}

// The destination dialog resolves HERE, before any encoded bytes move, so a
// cancel transfers nothing (the CT-219e/CT-219g begin pattern).
async function handleSaveImageBeginIpc(
  event: Electron.IpcMainInvokeEvent,
  request: SaveImageBeginRequest,
): Promise<SaveImageBeginResult> {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return { status: "canceled" };
  if (isSaveImageFolderBeginRequest(request)) {
    return beginFolderExportAfterDirectoryPick(window, request);
  }
  const dialogResult = await showImageSaveDialog(window, request);
  if (dialogResult.canceled || !dialogResult.filePath) return { status: "canceled" };
  return { status: "ready", token: await beginWriteSession(dialogResult.filePath, request) };
}

// CT-273: a folder export (PNG stack) picks a destination DIRECTORY.
async function beginFolderExportAfterDirectoryPick(
  window: BrowserWindow,
  request: SaveImageFolderBeginRequest,
): Promise<SaveImageBeginResult> {
  const dialogResult = await showOpenDialogOrStub(window, {
    title: "Choose a folder for the exported files",
    properties: ["openDirectory", "createDirectory"],
  });
  const folderPath = dialogResult.filePaths[0];
  if (dialogResult.canceled || !folderPath) return { status: "canceled" };
  return {
    status: "ready",
    token: await saveImageSessions.beginFilesInFolder(folderPath, request.files),
  };
}

async function beginWriteSession(
  primaryFilePath: string,
  request: SaveImageSingleFileBeginRequest,
): Promise<string> {
  return saveImageSessions.begin({
    primary: {
      filePath: primaryFilePath,
      byteLength: request.primaryByteLength,
      ...(request.primaryEncoding ? { encoding: request.primaryEncoding } : {}),
    },
    ...(request.sidecar
      ? {
          sidecar: {
            filePath: buildSidecarPathFromPrimary(primaryFilePath, request.sidecar.extension),
            byteLength: request.sidecar.byteLength,
          },
        }
      : {}),
  });
}

async function handleSaveImageChunkIpc(
  _event: Electron.IpcMainInvokeEvent,
  request: SaveImageChunkRequest,
): Promise<void> {
  await saveImageSessions.appendChunk(request.token, request.part, request.bytes);
}

async function handleSaveImageFinishIpc(
  _event: Electron.IpcMainInvokeEvent,
  request: SaveImageFinishRequest,
): Promise<SaveImageFinishResult> {
  return { filePath: await saveImageSessions.finishKeepingWrittenFiles(request.token) };
}

async function handleSaveImageReleaseIpc(
  _event: Electron.IpcMainInvokeEvent,
  request: SaveImageReleaseRequest,
): Promise<void> {
  await saveImageSessions.releaseDeletingPartialFiles(request.token);
}

export function registerSaveImageDialogIpcHandlers(): void {
  ipcMain.handle(SAVE_IMAGE_BEGIN_CHANNEL, handleSaveImageBeginIpc);
  ipcMain.handle(SAVE_IMAGE_CHUNK_CHANNEL, handleSaveImageChunkIpc);
  ipcMain.handle(SAVE_IMAGE_FINISH_CHANNEL, handleSaveImageFinishIpc);
  ipcMain.handle(SAVE_IMAGE_RELEASE_CHANNEL, handleSaveImageReleaseIpc);
}
