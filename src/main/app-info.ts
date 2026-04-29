import { app, ipcMain } from "electron";

export interface AppInfo {
  name: string;
  version: string;
}

const GET_APP_INFO_CHANNEL = "app:get-info";

function readApplicationInfoFromElectron(): AppInfo {
  return {
    name: app.getName(),
    version: app.getVersion(),
  };
}

export function registerAppInfoIpcHandler(): void {
  ipcMain.handle(GET_APP_INFO_CHANNEL, () => readApplicationInfoFromElectron());
}
