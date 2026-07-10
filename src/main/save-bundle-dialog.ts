import { BrowserWindow, ipcMain } from "electron";
import { unlink } from "node:fs/promises";
import { extname } from "node:path";

import { writeProjectBundleAtPath, type BundleDraft } from "./bundle-writer";
import { createSaveBundleSessionStore } from "./chunked-save-bundle";
import { showSaveDialogOrStub } from "./e2e-dialog-stub";
import {
  SAVE_BUNDLE_ASSET_CHUNK_CHANNEL,
  SAVE_BUNDLE_BEGIN_CHANNEL,
  SAVE_BUNDLE_FINISH_CHANNEL,
  SAVE_BUNDLE_RELEASE_CHANNEL,
  type SaveBundleAssetChunkRequest,
  type SaveBundleBeginRequest,
  type SaveBundleBeginResult,
  type SaveBundleFinishRequest,
  type SaveBundleFinishResult,
  type SaveBundleReleaseRequest,
} from "../shared/chunked-save-bundle-protocol";

const PROJECT_BUNDLE_EXTENSION = "ctbundle";

const saveBundleSessions = createSaveBundleSessionStore();

async function resolveBundleSavePath(
  window: BrowserWindow,
  request: SaveBundleBeginRequest,
): Promise<string | null> {
  if (!request.saveAs && hasUsableCurrentBundlePath(request.currentProjectFilePath)) {
    return request.currentProjectFilePath;
  }
  return showBundleSaveAsDialog(window, request.currentProjectFilePath);
}

function hasUsableCurrentBundlePath(currentProjectFilePath: string | null): boolean {
  if (!currentProjectFilePath) return false;
  return extname(currentProjectFilePath).toLowerCase() === `.${PROJECT_BUNDLE_EXTENSION}`;
}

async function showBundleSaveAsDialog(
  window: BrowserWindow,
  currentProjectFilePath: string | null,
): Promise<string | null> {
  const result = await showSaveDialogOrStub(window, {
    title: "Save Project As",
    defaultPath: deriveDefaultBundleSavePath(currentProjectFilePath),
    filters: [{ name: "Toolbox Project Bundle", extensions: [PROJECT_BUNDLE_EXTENSION] }],
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
}

function deriveDefaultBundleSavePath(currentProjectFilePath: string | null): string {
  if (!currentProjectFilePath) return `untitled.${PROJECT_BUNDLE_EXTENSION}`;
  const ext = extname(currentProjectFilePath);
  const stem = currentProjectFilePath.slice(0, currentProjectFilePath.length - ext.length);
  return `${stem}.${PROJECT_BUNDLE_EXTENSION}`;
}

async function writeBundleAtPathOrCleanUpOnFailure(
  outputPath: string,
  draft: BundleDraft,
): Promise<void> {
  try {
    await writeProjectBundleAtPath(outputPath, draft);
  } catch (error) {
    await tryRemoveFileIgnoringErrors(outputPath);
    throw error;
  }
}

async function tryRemoveFileIgnoringErrors(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // best-effort cleanup
  }
}

function findWindowForIpcEvent(
  event: Electron.IpcMainInvokeEvent,
): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

// The save dialog resolves HERE, before any baked asset bytes move, so a
// cancel uploads nothing (the CT-219g begin pattern).
async function handleSaveBundleBeginIpc(
  event: Electron.IpcMainInvokeEvent,
  request: SaveBundleBeginRequest,
): Promise<SaveBundleBeginResult> {
  const window = findWindowForIpcEvent(event);
  if (!window) return { status: "canceled" };
  const filePath = await resolveBundleSavePath(window, request);
  if (filePath === null) return { status: "canceled" };
  return { status: "ready", token: await saveBundleSessions.begin(request.header, filePath) };
}

async function handleSaveBundleAssetChunkIpc(
  _event: Electron.IpcMainInvokeEvent,
  request: SaveBundleAssetChunkRequest,
): Promise<void> {
  await saveBundleSessions.appendAssetChunk(
    request.token,
    request.viewportIndex,
    request.part,
    request.bytes,
  );
}

// A failure here rejects the invoke; the renderer flow surfaces it as an error
// toast. The session (and its spool files) is always released.
async function handleSaveBundleFinishIpc(
  _event: Electron.IpcMainInvokeEvent,
  request: SaveBundleFinishRequest,
): Promise<SaveBundleFinishResult> {
  try {
    const writable = await saveBundleSessions.takeWritableBundleDraft(request.token);
    await writeBundleAtPathOrCleanUpOnFailure(writable.outputFilePath, writable.draft);
    return { filePath: writable.outputFilePath };
  } finally {
    await saveBundleSessions.release(request.token);
  }
}

async function handleSaveBundleReleaseIpc(
  _event: Electron.IpcMainInvokeEvent,
  request: SaveBundleReleaseRequest,
): Promise<void> {
  await saveBundleSessions.release(request.token);
}

export function registerSaveBundleDialogIpcHandlers(): void {
  ipcMain.handle(SAVE_BUNDLE_BEGIN_CHANNEL, handleSaveBundleBeginIpc);
  ipcMain.handle(SAVE_BUNDLE_ASSET_CHUNK_CHANNEL, handleSaveBundleAssetChunkIpc);
  ipcMain.handle(SAVE_BUNDLE_FINISH_CHANNEL, handleSaveBundleFinishIpc);
  ipcMain.handle(SAVE_BUNDLE_RELEASE_CHANNEL, handleSaveBundleReleaseIpc);
}
