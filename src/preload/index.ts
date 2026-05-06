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
      sidecar?: OpenImageDialogSidecar;
    };

export interface SaveImageDialogFilter {
  name: string;
  extensions: ReadonlyArray<string>;
}

export interface SaveImageDialogRequest {
  suggestedFileName: string;
  bytes: Uint8Array;
  fileFilter: SaveImageDialogFilter;
}

export type SaveImageDialogResult =
  | { canceled: true }
  | { canceled: false; filePath: string };

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
const MENU_OPEN_IMAGE_CHANNEL = "menu:open-image";
const MENU_SAVE_IMAGE_CHANNEL = "menu:save-image";
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
  onMenuOpenImage: subscribeToOpenImageMenuEvent,
  onMenuSaveImage: subscribeToSaveImageMenuEvent,
  onMenuAbout: subscribeToAboutMenuEvent,
  initialTheme,
  onThemeChange: subscribeToThemeChanges,
} as const;

export type ToolboxApi = typeof apiBridge;

contextBridge.exposeInMainWorld("toolboxApi", apiBridge);
