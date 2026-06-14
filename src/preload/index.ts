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

export interface OpenImagesDialogFileMetadataEntry {
  fileName: string;
  filePath: string;
  fileSizeBytes: number;
  mtimeMs: number;
}

export type OpenImagesDialogResult =
  | { canceled: true }
  | { canceled: false; files: ReadonlyArray<OpenImagesDialogFileMetadataEntry> };

export interface OpenedImagesFileSidecar {
  fileName: string;
  bytes: Uint8Array;
}

export interface OpenedImagesFileEntry {
  fileName: string;
  filePath: string;
  bytes: Uint8Array;
  contentHash: string;
  fileSizeBytes: number;
  mtimeMs: number;
  sidecar?: OpenedImagesFileSidecar;
}

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

export interface SaveBundleDraftRenderingState {
  normalizationEnabled: boolean;
  selectedBandIndex: number;
  lastAppliedOperationLabel: string | null;
}

export type SaveBundleDraftOperationHistoryParameterValue = number | string | boolean;

export interface SaveBundleDraftOperationHistoryEntry {
  actionId: string;
  actionLabel: string;
  appliedLabel: string;
  parameterValues: Readonly<Record<string, SaveBundleDraftOperationHistoryParameterValue>>;
  timestampMs: number;
}

export interface SaveBundleDraftBakedAssetSidecar {
  extension: string;
  bytes: Uint8Array;
}

export interface SaveBundleDraftBakedAsset {
  kind: "baked";
  bytes: Uint8Array;
  extension: string;
  sidecar?: SaveBundleDraftBakedAssetSidecar;
}

export interface SaveBundleDraftExternalAsset {
  kind: "external";
  absolutePath: string;
  extension: string;
}

export type SaveBundleDraftAsset =
  | SaveBundleDraftBakedAsset
  | SaveBundleDraftExternalAsset;

export interface SaveBundleDraftViewportEntry {
  index: number;
  fileName: string;
  asset: SaveBundleDraftAsset;
  renderingState: SaveBundleDraftRenderingState;
  operationHistory: ReadonlyArray<SaveBundleDraftOperationHistoryEntry>;
}

export interface SaveBundleDraft {
  formatVersion: number;
  gridLayout: string;
  selectedViewportIndices: ReadonlyArray<number>;
  viewports: ReadonlyArray<SaveBundleDraftViewportEntry>;
}

export interface SaveBundleDialogRequest {
  draft: SaveBundleDraft;
  currentProjectFilePath: string | null;
  saveAs: boolean;
}

export type SaveBundleDialogResult =
  | { canceled: true }
  | { canceled: false; filePath: string };

export type OpenBundleDialogResult =
  | { canceled: true }
  | { canceled: false; projectFilePath: string; bytes: Uint8Array };

export interface ReadBundleAssetRequest {
  projectFilePath: string;
  relativePath: string;
}

export interface ReadBundleAssetSidecar {
  fileName: string;
  bytes: Uint8Array;
}

export type ReadBundleAssetResult =
  | { kind: "missing"; relativePath: string }
  | {
      kind: "found";
      absolutePath: string;
      fileName: string;
      bytes: Uint8Array;
      sidecar?: ReadBundleAssetSidecar;
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
const OPEN_IMAGES_DIALOG_CHANNEL = "image:open-images-dialog";
const OPEN_IMAGES_READ_FILE_CHANNEL = "image:open-images-read-file";
const SAVE_IMAGE_DIALOG_CHANNEL = "image:save-dialog";
const OPEN_BUNDLE_DIALOG_CHANNEL = "project:open-bundle-dialog";
const READ_BUNDLE_ASSET_CHANNEL = "project:read-bundle-asset";
const SAVE_BUNDLE_DIALOG_CHANNEL = "project:save-bundle-dialog";
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

function showOpenImagesDialogThroughMainProcess(): Promise<OpenImagesDialogResult> {
  return ipcRenderer.invoke(
    OPEN_IMAGES_DIALOG_CHANNEL,
  ) as Promise<OpenImagesDialogResult>;
}

function readSingleOpenedImageFileThroughMainProcess(
  metadata: OpenImagesDialogFileMetadataEntry,
): Promise<OpenedImagesFileEntry> {
  return ipcRenderer.invoke(
    OPEN_IMAGES_READ_FILE_CHANNEL,
    metadata,
  ) as Promise<OpenedImagesFileEntry>;
}

function showSaveImageDialogThroughMainProcess(
  request: SaveImageDialogRequest,
): Promise<SaveImageDialogResult> {
  return ipcRenderer.invoke(
    SAVE_IMAGE_DIALOG_CHANNEL,
    request,
  ) as Promise<SaveImageDialogResult>;
}

function showOpenBundleDialogThroughMainProcess(): Promise<OpenBundleDialogResult> {
  return ipcRenderer.invoke(
    OPEN_BUNDLE_DIALOG_CHANNEL,
  ) as Promise<OpenBundleDialogResult>;
}

function readBundleAssetThroughMainProcess(
  request: ReadBundleAssetRequest,
): Promise<ReadBundleAssetResult> {
  return ipcRenderer.invoke(
    READ_BUNDLE_ASSET_CHANNEL,
    request,
  ) as Promise<ReadBundleAssetResult>;
}

function showSaveBundleDialogThroughMainProcess(
  request: SaveBundleDialogRequest,
): Promise<SaveBundleDialogResult> {
  return ipcRenderer.invoke(
    SAVE_BUNDLE_DIALOG_CHANNEL,
    request,
  ) as Promise<SaveBundleDialogResult>;
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
  openImagesDialog: showOpenImagesDialogThroughMainProcess,
  readOpenedImageFile: readSingleOpenedImageFileThroughMainProcess,
  saveImageDialog: showSaveImageDialogThroughMainProcess,
  openProjectBundleDialog: showOpenBundleDialogThroughMainProcess,
  readProjectBundleAsset: readBundleAssetThroughMainProcess,
  saveProjectBundleDialog: showSaveBundleDialogThroughMainProcess,
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

// Keep this literal in sync with E2E_TEST_MODE_PRELOAD_ARGUMENT in src/main/e2e-dialog-stub.ts.
const E2E_TEST_MODE_PRELOAD_ARGUMENT = "--msi-e2e-test-mode";
const ENQUEUE_OPEN_DIALOG_PATHS_CHANNEL = "test:enqueue-open-dialog-paths";
const ENQUEUE_SAVE_DIALOG_PATH_CHANNEL = "test:enqueue-save-dialog-path";
const RESET_DIALOG_QUEUES_CHANNEL = "test:reset-dialog-queues";

function isE2eTestModeEnabled(): boolean {
  return process.argv.includes(E2E_TEST_MODE_PRELOAD_ARGUMENT);
}

function enqueueOpenDialogPathsForTest(filePaths: ReadonlyArray<string>): Promise<void> {
  return ipcRenderer.invoke(ENQUEUE_OPEN_DIALOG_PATHS_CHANNEL, filePaths) as Promise<void>;
}

function enqueueSaveDialogPathForTest(filePath: string): Promise<void> {
  return ipcRenderer.invoke(ENQUEUE_SAVE_DIALOG_PATH_CHANNEL, filePath) as Promise<void>;
}

function resetDialogQueuesForTest(): Promise<void> {
  return ipcRenderer.invoke(RESET_DIALOG_QUEUES_CHANNEL) as Promise<void>;
}

const e2eTestBridge = {
  enqueueOpenDialogPaths: enqueueOpenDialogPathsForTest,
  enqueueSaveDialogPath: enqueueSaveDialogPathForTest,
  resetDialogQueues: resetDialogQueuesForTest,
} as const;

export type ToolboxE2eBridge = typeof e2eTestBridge;

function exposeE2eTestBridgeWhenEnabled(): void {
  if (!isE2eTestModeEnabled()) return;
  contextBridge.exposeInMainWorld("toolboxE2E", e2eTestBridge);
}

exposeE2eTestBridgeWhenEnabled();
