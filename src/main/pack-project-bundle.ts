import { BrowserWindow, dialog, ipcMain } from "electron";
import { unlink } from "node:fs/promises";
import { extname } from "node:path";

import {
  writeProjectBundleAtPath,
  type PackBundleDraft,
} from "./bundle-writer";

const PACK_PROJECT_BUNDLE_CHANNEL = "project:pack-bundle";

export interface PackProjectBundleRequest {
  readonly draft: PackBundleDraft;
  readonly currentProjectFilePath: string | null;
}

export type PackProjectBundleResult =
  | { canceled: true }
  | { canceled: false; filePath: string };

async function chooseBundleSavePath(
  window: BrowserWindow,
  currentProjectFilePath: string | null,
): Promise<string | null> {
  const result = await dialog.showSaveDialog(window, {
    title: "Pack Project As Bundle",
    defaultPath: deriveDefaultBundleSavePath(currentProjectFilePath),
    filters: [{ name: "Toolbox Project Bundle", extensions: ["ctbundle"] }],
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
}

function deriveDefaultBundleSavePath(currentProjectFilePath: string | null): string {
  if (!currentProjectFilePath) return "untitled.ctbundle";
  const ext = extname(currentProjectFilePath);
  const stem = currentProjectFilePath.slice(0, currentProjectFilePath.length - ext.length);
  return `${stem}.ctbundle`;
}

async function writeBundleAtPathOrCleanUpOnFailure(
  outputPath: string,
  draft: PackBundleDraft,
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

async function performPackProjectBundleFlow(
  window: BrowserWindow,
  request: PackProjectBundleRequest,
): Promise<PackProjectBundleResult> {
  const filePath = await chooseBundleSavePath(window, request.currentProjectFilePath);
  if (filePath === null) return { canceled: true };
  await writeBundleAtPathOrCleanUpOnFailure(filePath, request.draft);
  return { canceled: false, filePath };
}

function findWindowForIpcEvent(
  event: Electron.IpcMainInvokeEvent,
): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

async function handlePackProjectBundleIpc(
  event: Electron.IpcMainInvokeEvent,
  request: PackProjectBundleRequest,
): Promise<PackProjectBundleResult> {
  const window = findWindowForIpcEvent(event);
  if (!window) return { canceled: true };
  return performPackProjectBundleFlow(window, request);
}

export function registerPackProjectBundleIpcHandler(): void {
  ipcMain.handle(PACK_PROJECT_BUNDLE_CHANNEL, handlePackProjectBundleIpc);
}
