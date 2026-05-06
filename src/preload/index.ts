import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

export interface AppInfo {
  name: string;
  version: string;
}

export interface OpenImageDialogSidecar {
  fileName: string;
  bytes: Uint8Array;
}

export type OpenImageDialogResult =
  | { canceled: true }
  | {
      canceled: false;
      filePath: string;
      fileName: string;
      bytes: Uint8Array;
      contentHash: string;
      sidecar?: OpenImageDialogSidecar;
    };

export interface SaveImageDialogFilter {
  name: string;
  extensions: ReadonlyArray<string>;
}

export interface SaveImageDialogSidecar {
  extension: string;
  bytes: Uint8Array;
}

export interface SaveImageDialogRequest {
  suggestedFileName: string;
  bytes: Uint8Array;
  fileFilter: SaveImageDialogFilter;
  sidecar?: SaveImageDialogSidecar;
}

export type SaveImageDialogResult =
  | { canceled: true }
  | { canceled: false; filePath: string };

export interface SaveProjectDraftViewportSource {
  absolutePath: string;
  contentHash: string;
  fileName: string;
}

export interface SaveProjectDraftViewportRenderingState {
  normalizationEnabled: boolean;
  selectedBandIndex: number;
  lastAppliedOperationLabel: string | null;
}

export interface SaveProjectDraftViewportEntry {
  index: number;
  source: SaveProjectDraftViewportSource;
  renderingState: SaveProjectDraftViewportRenderingState;
}

export interface SaveProjectDraft {
  formatVersion: number;
  gridLayout: string;
  selectedViewportIndices: ReadonlyArray<number>;
  viewports: ReadonlyArray<SaveProjectDraftViewportEntry>;
}

export interface SaveProjectDialogRequest {
  draft: SaveProjectDraft;
  currentProjectFilePath: string | null;
  saveAs: boolean;
}

export type SaveProjectDialogResult =
  | { canceled: true }
  | { canceled: false; filePath: string };

export type OpenProjectDialogResult =
  | { canceled: true }
  | { canceled: false; filePath: string; bytes: Uint8Array };

export interface ResolveProjectSourceRequest {
  projectFilePath: string;
  relativePath: string;
}

export interface ResolveProjectSourceSidecar {
  fileName: string;
  bytes: Uint8Array;
}

export type ResolveProjectSourceResult =
  | { kind: "missing" }
  | {
      kind: "found";
      absolutePath: string;
      fileName: string;
      bytes: Uint8Array;
      contentHash: string;
      sidecar?: ResolveProjectSourceSidecar;
    };

export interface LocateMissingProjectSourceRequest {
  originalFileName: string;
  defaultDir: string | null;
}

export type LocateMissingProjectSourceResult =
  | { kind: "canceled" }
  | {
      kind: "picked";
      absolutePath: string;
      fileName: string;
      bytes: Uint8Array;
      contentHash: string;
      sidecar?: ResolveProjectSourceSidecar;
    };

export type ThemeMode = "system" | "light" | "dark";

export interface ThemeSnapshot {
  mode: ThemeMode;
  isDark: boolean;
}

export type MenuEventListener = () => void;
export type UnsubscribeMenuListener = () => void;
export type ThemeChangeListener = (snapshot: ThemeSnapshot) => void;
export type UnsubscribeThemeListener = () => void;

const GET_APP_INFO_CHANNEL = "app:get-info";
const OPEN_IMAGE_DIALOG_CHANNEL = "image:open-dialog";
const SAVE_IMAGE_DIALOG_CHANNEL = "image:save-dialog";
const OPEN_PROJECT_DIALOG_CHANNEL = "project:open-dialog";
const SAVE_PROJECT_DIALOG_CHANNEL = "project:save-dialog";
const RESOLVE_PROJECT_SOURCE_CHANNEL = "project:resolve-source";
const LOCATE_MISSING_PROJECT_SOURCE_CHANNEL = "project:locate-missing-source";
const MENU_OPEN_IMAGE_CHANNEL = "menu:open-image";
const MENU_SAVE_IMAGE_CHANNEL = "menu:save-image";
const MENU_OPEN_PROJECT_CHANNEL = "menu:open-project";
const MENU_SAVE_PROJECT_CHANNEL = "menu:save-project";
const MENU_SAVE_PROJECT_AS_CHANNEL = "menu:save-project-as";
const MENU_ABOUT_CHANNEL = "menu:about";
const THEME_GET_INITIAL_SYNC_CHANNEL = "theme:get-initial-sync";
const THEME_CHANGED_CHANNEL = "theme:changed";

function fetchAppInfoFromMainProcess(): Promise<AppInfo> {
  return ipcRenderer.invoke(GET_APP_INFO_CHANNEL) as Promise<AppInfo>;
}

function showOpenImageDialogThroughMainProcess(): Promise<OpenImageDialogResult> {
  return ipcRenderer.invoke(
    OPEN_IMAGE_DIALOG_CHANNEL,
  ) as Promise<OpenImageDialogResult>;
}

function showSaveImageDialogThroughMainProcess(
  request: SaveImageDialogRequest,
): Promise<SaveImageDialogResult> {
  return ipcRenderer.invoke(
    SAVE_IMAGE_DIALOG_CHANNEL,
    request,
  ) as Promise<SaveImageDialogResult>;
}

function showOpenProjectDialogThroughMainProcess(): Promise<OpenProjectDialogResult> {
  return ipcRenderer.invoke(
    OPEN_PROJECT_DIALOG_CHANNEL,
  ) as Promise<OpenProjectDialogResult>;
}

function showSaveProjectDialogThroughMainProcess(
  request: SaveProjectDialogRequest,
): Promise<SaveProjectDialogResult> {
  return ipcRenderer.invoke(
    SAVE_PROJECT_DIALOG_CHANNEL,
    request,
  ) as Promise<SaveProjectDialogResult>;
}

function resolveProjectSourceThroughMainProcess(
  request: ResolveProjectSourceRequest,
): Promise<ResolveProjectSourceResult> {
  return ipcRenderer.invoke(
    RESOLVE_PROJECT_SOURCE_CHANNEL,
    request,
  ) as Promise<ResolveProjectSourceResult>;
}

function locateMissingProjectSourceThroughMainProcess(
  request: LocateMissingProjectSourceRequest,
): Promise<LocateMissingProjectSourceResult> {
  return ipcRenderer.invoke(
    LOCATE_MISSING_PROJECT_SOURCE_CHANNEL,
    request,
  ) as Promise<LocateMissingProjectSourceResult>;
}

function subscribeToMenuChannel(
  channel: string,
  listener: MenuEventListener,
): UnsubscribeMenuListener {
  const handler = (_event: IpcRendererEvent): void => listener();
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

function subscribeToOpenImageMenuEvent(
  listener: MenuEventListener,
): UnsubscribeMenuListener {
  return subscribeToMenuChannel(MENU_OPEN_IMAGE_CHANNEL, listener);
}

function subscribeToSaveImageMenuEvent(
  listener: MenuEventListener,
): UnsubscribeMenuListener {
  return subscribeToMenuChannel(MENU_SAVE_IMAGE_CHANNEL, listener);
}

function subscribeToOpenProjectMenuEvent(
  listener: MenuEventListener,
): UnsubscribeMenuListener {
  return subscribeToMenuChannel(MENU_OPEN_PROJECT_CHANNEL, listener);
}

function subscribeToSaveProjectMenuEvent(
  listener: MenuEventListener,
): UnsubscribeMenuListener {
  return subscribeToMenuChannel(MENU_SAVE_PROJECT_CHANNEL, listener);
}

function subscribeToSaveProjectAsMenuEvent(
  listener: MenuEventListener,
): UnsubscribeMenuListener {
  return subscribeToMenuChannel(MENU_SAVE_PROJECT_AS_CHANNEL, listener);
}

function subscribeToAboutMenuEvent(
  listener: MenuEventListener,
): UnsubscribeMenuListener {
  return subscribeToMenuChannel(MENU_ABOUT_CHANNEL, listener);
}

function readInitialThemeSnapshotSynchronously(): ThemeSnapshot {
  return ipcRenderer.sendSync(THEME_GET_INITIAL_SYNC_CHANNEL) as ThemeSnapshot;
}

function subscribeToThemeChanges(
  listener: ThemeChangeListener,
): UnsubscribeThemeListener {
  const handler = (_event: IpcRendererEvent, snapshot: ThemeSnapshot): void =>
    listener(snapshot);
  ipcRenderer.on(THEME_CHANGED_CHANNEL, handler);
  return () => ipcRenderer.removeListener(THEME_CHANGED_CHANNEL, handler);
}

const initialTheme = readInitialThemeSnapshotSynchronously();

const apiBridge = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  getAppInfo: fetchAppInfoFromMainProcess,
  openImageDialog: showOpenImageDialogThroughMainProcess,
  saveImageDialog: showSaveImageDialogThroughMainProcess,
  openProjectDialog: showOpenProjectDialogThroughMainProcess,
  saveProjectDialog: showSaveProjectDialogThroughMainProcess,
  resolveProjectSource: resolveProjectSourceThroughMainProcess,
  locateMissingProjectSource: locateMissingProjectSourceThroughMainProcess,
  onMenuOpenImage: subscribeToOpenImageMenuEvent,
  onMenuSaveImage: subscribeToSaveImageMenuEvent,
  onMenuOpenProject: subscribeToOpenProjectMenuEvent,
  onMenuSaveProject: subscribeToSaveProjectMenuEvent,
  onMenuSaveProjectAs: subscribeToSaveProjectAsMenuEvent,
  onMenuAbout: subscribeToAboutMenuEvent,
  initialTheme,
  onThemeChange: subscribeToThemeChanges,
} as const;

export type ToolboxApi = typeof apiBridge;

contextBridge.exposeInMainWorld("toolboxApi", apiBridge);
