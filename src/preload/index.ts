import { contextBridge } from "electron";

const apiBridge = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
} as const;

export type ToolboxApi = typeof apiBridge;

contextBridge.exposeInMainWorld("toolboxApi", apiBridge);
