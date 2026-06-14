import { BrowserWindow, ipcMain } from "electron";
import { unlink } from "node:fs/promises";
import { extname } from "node:path";

import {
  writeProjectBundleAtPath,
  type BundleDraft,
} from "./bundle-writer";
import { showSaveDialogOrStub } from "./e2e-dialog-stub";

const SAVE_BUNDLE_DIALOG_CHANNEL = "project:save-bundle-dialog";
const PROJECT_BUNDLE_EXTENSION = "ctbundle";

export interface SaveBundleDialogRequest {
  readonly draft: BundleDraft;
  readonly currentProjectFilePath: string | null;
  readonly saveAs: boolean;
}

export type SaveBundleDialogResult =
  | { canceled: true }
  | { canceled: false; filePath: string };

async function resolveBundleSavePath(
  window: BrowserWindow,
  request: SaveBundleDialogRequest,
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

async function performSaveBundleFlow(
  window: BrowserWindow,
  request: SaveBundleDialogRequest,
): Promise<SaveBundleDialogResult> {
  const filePath = await resolveBundleSavePath(window, request);
  if (filePath === null) return { canceled: true };
  await writeBundleAtPathOrCleanUpOnFailure(filePath, request.draft);
  return { canceled: false, filePath };
}

function findWindowForIpcEvent(
  event: Electron.IpcMainInvokeEvent,
): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

async function handleSaveBundleDialogIpc(
  event: Electron.IpcMainInvokeEvent,
  request: SaveBundleDialogRequest,
): Promise<SaveBundleDialogResult> {
  const window = findWindowForIpcEvent(event);
  if (!window) return { canceled: true };
  return performSaveBundleFlow(window, request);
}

export function registerSaveBundleDialogIpcHandler(): void {
  ipcMain.handle(SAVE_BUNDLE_DIALOG_CHANNEL, handleSaveBundleDialogIpc);
}
