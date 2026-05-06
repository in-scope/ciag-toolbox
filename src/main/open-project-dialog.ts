import { BrowserWindow, dialog, ipcMain } from "electron";
import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";

import { computeSha256HexFromBytes } from "./content-hash";

const OPEN_PROJECT_DIALOG_CHANNEL = "project:open-dialog";
const RESOLVE_PROJECT_SOURCE_CHANNEL = "project:resolve-source";
const LOCATE_MISSING_PROJECT_SOURCE_CHANNEL = "project:locate-missing-source";

const ENVI_HEADER_EXTENSION = ".hdr";
const ENVI_BINARY_EXTENSION_CANDIDATES: ReadonlyArray<string> = [
  ".bin",
  ".dat",
  ".img",
  ".raw",
  "",
];

export type OpenProjectDialogResult =
  | { canceled: true }
  | { canceled: false; filePath: string; bytes: Uint8Array };

export interface ResolveProjectSourceRequest {
  readonly projectFilePath: string;
  readonly relativePath: string;
}

export interface ResolvedProjectSourceSidecar {
  readonly fileName: string;
  readonly bytes: Uint8Array;
}

export type ResolveProjectSourceResult =
  | { kind: "missing" }
  | {
      kind: "found";
      absolutePath: string;
      fileName: string;
      bytes: Uint8Array;
      contentHash: string;
      sidecar?: ResolvedProjectSourceSidecar;
    };

export interface LocateMissingProjectSourceRequest {
  readonly originalFileName: string;
  readonly defaultDir: string | null;
}

export type LocateMissingProjectSourceResult =
  | { kind: "canceled" }
  | {
      kind: "picked";
      absolutePath: string;
      fileName: string;
      bytes: Uint8Array;
      contentHash: string;
      sidecar?: ResolvedProjectSourceSidecar;
    };

async function showOpenProjectDialog(
  window: BrowserWindow,
): Promise<OpenProjectDialogResult> {
  const result = await dialog.showOpenDialog(window, {
    title: "Open Project",
    properties: ["openFile"],
    filters: [{ name: "Toolbox Project", extensions: ["ctproj"] }],
  });
  const [firstPath] = result.filePaths;
  if (result.canceled || firstPath === undefined) return { canceled: true };
  const bytes = await readFileAsBytes(firstPath);
  return { canceled: false, filePath: firstPath, bytes };
}

async function readFileAsBytes(filePath: string): Promise<Uint8Array> {
  const buffer = await readFile(filePath);
  return new Uint8Array(buffer);
}

function resolveAbsolutePathFromProjectFile(
  projectFilePath: string,
  relativePath: string,
): string {
  if (isAbsolute(relativePath)) return relativePath;
  return resolve(dirname(projectFilePath), relativePath);
}

async function tryReadResolvedSource(
  absolutePath: string,
): Promise<ResolveProjectSourceResult> {
  try {
    return await readResolvedSourceWithSidecar(absolutePath);
  } catch {
    return { kind: "missing" };
  }
}

async function readResolvedSourceWithSidecar(
  absolutePath: string,
): Promise<ResolveProjectSourceResult> {
  const bytes = await readFileAsBytes(absolutePath);
  const contentHash = computeSha256HexFromBytes(bytes);
  const sidecar = await findEnviSidecarIfApplicable(absolutePath);
  return {
    kind: "found",
    absolutePath,
    fileName: basename(absolutePath),
    bytes,
    contentHash,
    ...(sidecar ? { sidecar } : {}),
  };
}

async function findEnviSidecarIfApplicable(
  filePath: string,
): Promise<ResolvedProjectSourceSidecar | undefined> {
  if (extname(filePath).toLowerCase() !== ENVI_HEADER_EXTENSION) return undefined;
  return findEnviBinarySiblingForHeader(filePath);
}

async function findEnviBinarySiblingForHeader(
  headerPath: string,
): Promise<ResolvedProjectSourceSidecar | undefined> {
  const directoryEntries = await readdir(dirname(headerPath));
  const matchingEntry = pickEnviBinarySiblingFromEntries(headerPath, directoryEntries);
  if (!matchingEntry) return undefined;
  const siblingPath = join(dirname(headerPath), matchingEntry);
  return { fileName: matchingEntry, bytes: await readFileAsBytes(siblingPath) };
}

function pickEnviBinarySiblingFromEntries(
  headerPath: string,
  directoryEntries: ReadonlyArray<string>,
): string | undefined {
  const headerBaseLower = basename(headerPath, extname(headerPath)).toLowerCase();
  for (const candidate of ENVI_BINARY_EXTENSION_CANDIDATES) {
    const match = directoryEntries.find((entry) =>
      entryMatchesEnviSiblingCandidate(entry, headerBaseLower, candidate),
    );
    if (match) return match;
  }
  return undefined;
}

function entryMatchesEnviSiblingCandidate(
  entry: string,
  baseNameLower: string,
  expectedExtensionLower: string,
): boolean {
  const entryLower = entry.toLowerCase();
  if (expectedExtensionLower === "") return entryLower === baseNameLower;
  return entryLower === baseNameLower + expectedExtensionLower;
}

async function showLocateMissingSourceDialog(
  window: BrowserWindow,
  request: LocateMissingProjectSourceRequest,
): Promise<LocateMissingProjectSourceResult> {
  const result = await dialog.showOpenDialog(window, {
    title: `Locate "${request.originalFileName}"`,
    properties: ["openFile"],
    defaultPath: request.defaultDir ?? undefined,
  });
  const [firstPath] = result.filePaths;
  if (result.canceled || firstPath === undefined) return { kind: "canceled" };
  return readPickedSourceAsLocatedResult(firstPath);
}

async function readPickedSourceAsLocatedResult(
  absolutePath: string,
): Promise<LocateMissingProjectSourceResult> {
  const bytes = await readFileAsBytes(absolutePath);
  const contentHash = computeSha256HexFromBytes(bytes);
  const sidecar = await findEnviSidecarIfApplicable(absolutePath);
  return {
    kind: "picked",
    absolutePath,
    fileName: basename(absolutePath),
    bytes,
    contentHash,
    ...(sidecar ? { sidecar } : {}),
  };
}

function findWindowForIpcEvent(
  event: Electron.IpcMainInvokeEvent,
): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

async function handleOpenProjectDialogIpc(
  event: Electron.IpcMainInvokeEvent,
): Promise<OpenProjectDialogResult> {
  const window = findWindowForIpcEvent(event);
  if (!window) return { canceled: true };
  return showOpenProjectDialog(window);
}

async function handleResolveProjectSourceIpc(
  _event: Electron.IpcMainInvokeEvent,
  request: ResolveProjectSourceRequest,
): Promise<ResolveProjectSourceResult> {
  const absolutePath = resolveAbsolutePathFromProjectFile(
    request.projectFilePath,
    request.relativePath,
  );
  return tryReadResolvedSource(absolutePath);
}

async function handleLocateMissingProjectSourceIpc(
  event: Electron.IpcMainInvokeEvent,
  request: LocateMissingProjectSourceRequest,
): Promise<LocateMissingProjectSourceResult> {
  const window = findWindowForIpcEvent(event);
  if (!window) return { kind: "canceled" };
  return showLocateMissingSourceDialog(window, request);
}

export function registerOpenProjectDialogIpcHandlers(): void {
  ipcMain.handle(OPEN_PROJECT_DIALOG_CHANNEL, handleOpenProjectDialogIpc);
  ipcMain.handle(RESOLVE_PROJECT_SOURCE_CHANNEL, handleResolveProjectSourceIpc);
  ipcMain.handle(LOCATE_MISSING_PROJECT_SOURCE_CHANNEL, handleLocateMissingProjectSourceIpc);
}
