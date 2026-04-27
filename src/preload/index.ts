import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

export interface AppInfo {
  name: string;
  version: string;
}

export type MenuEventListener = () => void;
export type UnsubscribeMenuListener = () => void;

const GET_APP_INFO_CHANNEL = "app:get-info";
const MENU_OPEN_IMAGE_CHANNEL = "menu:open-image";
const MENU_ABOUT_CHANNEL = "menu:about";

function fetchAppInfoFromMainProcess(): Promise<AppInfo> {
  return ipcRenderer.invoke(GET_APP_INFO_CHANNEL) as Promise<AppInfo>;
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

function subscribeToAboutMenuEvent(
  listener: MenuEventListener,
): UnsubscribeMenuListener {
  return subscribeToMenuChannel(MENU_ABOUT_CHANNEL, listener);
}

const apiBridge = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  getAppInfo: fetchAppInfoFromMainProcess,
  onMenuOpenImage: subscribeToOpenImageMenuEvent,
  onMenuAbout: subscribeToAboutMenuEvent,
} as const;

export type ToolboxApi = typeof apiBridge;

contextBridge.exposeInMainWorld("toolboxApi", apiBridge);
