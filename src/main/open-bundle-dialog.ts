import { BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";

import { showOpenDialogOrStub } from "./e2e-dialog-stub";
import { extractProjectBundleToFreshTempDirectory } from "./extract-project-bundle";
import { readFileWithinOpenableSizeLimitOrThrow } from "./openable-file-size-limit";
import {
  resolveBundleAssetToFileMetadata,
  type ResolveBundleAssetRequest,
  type ResolveBundleAssetResult,
} from "./resolve-bundle-asset";

const OPEN_BUNDLE_DIALOG_CHANNEL = "project:open-bundle-dialog";
const RESOLVE_BUNDLE_ASSET_CHANNEL = "project:resolve-bundle-asset";

const PROJECT_BUNDLE_EXTENSION = "ctbundle";
const BUNDLE_PROJECT_JSON_FILE_NAME = "project.json";

// The dialog reply carries only the small project.json manifest; asset bytes
// never cross IPC whole. The renderer resolves each asset to metadata via
// project:resolve-bundle-asset and streams it through the chunked
// opened-image read protocol (CT-236, see resolve-bundle-asset.ts).
export type OpenBundleDialogResult =
  | { canceled: true }
  | { canceled: false; projectFilePath: string; bytes: Uint8Array };

async function showOpenBundleDialog(
  window: BrowserWindow,
): Promise<OpenBundleDialogResult> {
  const result = await showOpenDialogOrStub(window, {
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
  const bytes = await readFileWithinOpenableSizeLimitOrThrow(projectJsonPath);
  return { canceled: false, projectFilePath: projectJsonPath, bytes };
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

async function handleResolveBundleAssetIpc(
  _event: Electron.IpcMainInvokeEvent,
  request: ResolveBundleAssetRequest,
): Promise<ResolveBundleAssetResult> {
  return resolveBundleAssetToFileMetadata(request);
}

export function registerOpenBundleDialogIpcHandlers(): void {
  ipcMain.handle(OPEN_BUNDLE_DIALOG_CHANNEL, handleOpenBundleDialogIpc);
  ipcMain.handle(RESOLVE_BUNDLE_ASSET_CHANNEL, handleResolveBundleAssetIpc);
}
