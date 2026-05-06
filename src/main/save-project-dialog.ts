import { BrowserWindow, dialog, ipcMain } from "electron";
import { writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";

const SAVE_PROJECT_DIALOG_CHANNEL = "project:save-dialog";

export interface DraftViewportSourceForSave {
  readonly absolutePath: string;
  readonly contentHash: string;
  readonly fileName: string;
}

export interface DraftViewportEntryForSave {
  readonly index: number;
  readonly source: DraftViewportSourceForSave;
  readonly renderingState: {
    readonly normalizationEnabled: boolean;
    readonly selectedBandIndex: number;
    readonly lastAppliedOperationLabel: string | null;
  };
}

export interface DraftProjectForSave {
  readonly formatVersion: number;
  readonly gridLayout: string;
  readonly selectedViewportIndices: ReadonlyArray<number>;
  readonly viewports: ReadonlyArray<DraftViewportEntryForSave>;
}

export interface SaveProjectDialogRequest {
  readonly draft: DraftProjectForSave;
  readonly currentProjectFilePath: string | null;
  readonly saveAs: boolean;
}

export type SaveProjectDialogResult =
  | { canceled: true }
  | { canceled: false; filePath: string };

async function resolveProjectSavePath(
  window: BrowserWindow,
  request: SaveProjectDialogRequest,
): Promise<string | null> {
  if (!request.saveAs && request.currentProjectFilePath) {
    return request.currentProjectFilePath;
  }
  return chooseProjectSavePath(window, request.currentProjectFilePath);
}

async function chooseProjectSavePath(
  window: BrowserWindow,
  currentProjectFilePath: string | null,
): Promise<string | null> {
  const result = await dialog.showSaveDialog(window, {
    title: "Save Project As",
    defaultPath: currentProjectFilePath ?? "untitled.ctproj",
    filters: [{ name: "Toolbox Project", extensions: ["ctproj"] }],
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
}

function relativizeViewportSourcePathsForProjectFile(
  draft: DraftProjectForSave,
  projectFilePath: string,
): unknown {
  const projectDir = dirname(projectFilePath);
  return {
    formatVersion: draft.formatVersion,
    gridLayout: draft.gridLayout,
    selectedViewportIndices: draft.selectedViewportIndices,
    viewports: draft.viewports.map((entry) =>
      buildOnDiskViewportEntry(entry, projectDir),
    ),
  };
}

function buildOnDiskViewportEntry(
  entry: DraftViewportEntryForSave,
  projectDir: string,
): unknown {
  return {
    index: entry.index,
    source: {
      relativePath: toForwardSlashRelativePath(projectDir, entry.source.absolutePath),
      contentHash: entry.source.contentHash,
      fileName: entry.source.fileName,
    },
    renderingState: entry.renderingState,
    viewTransform: { zoom: 1, panX: 0, panY: 0 },
    operationHistory: [],
    roi: null,
  };
}

function toForwardSlashRelativePath(fromDir: string, absolutePath: string): string {
  const relativePath = relative(fromDir, absolutePath);
  return relativePath.split("\\").join("/");
}

async function writeProjectJsonToFile(
  filePath: string,
  draft: DraftProjectForSave,
): Promise<void> {
  const onDisk = relativizeViewportSourcePathsForProjectFile(draft, filePath);
  const json = JSON.stringify(onDisk, null, 2);
  await writeFile(filePath, json, "utf-8");
}

async function performSaveProjectFlow(
  window: BrowserWindow,
  request: SaveProjectDialogRequest,
): Promise<SaveProjectDialogResult> {
  const filePath = await resolveProjectSavePath(window, request);
  if (filePath === null) return { canceled: true };
  await writeProjectJsonToFile(filePath, request.draft);
  return { canceled: false, filePath };
}

function findWindowForIpcEvent(
  event: Electron.IpcMainInvokeEvent,
): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

async function handleSaveProjectDialogIpc(
  event: Electron.IpcMainInvokeEvent,
  request: SaveProjectDialogRequest,
): Promise<SaveProjectDialogResult> {
  const window = findWindowForIpcEvent(event);
  if (!window) return { canceled: true };
  return performSaveProjectFlow(window, request);
}

export function registerSaveProjectDialogIpcHandler(): void {
  ipcMain.handle(SAVE_PROJECT_DIALOG_CHANNEL, handleSaveProjectDialogIpc);
}
