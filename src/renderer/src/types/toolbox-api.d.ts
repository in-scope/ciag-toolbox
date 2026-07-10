interface ToolboxAppInfo {
  name: string;
  version: string;
}

interface ToolboxOpenImageDialogSidecar {
  fileName: string;
  bytes: Uint8Array;
}

type ToolboxOpenImageDialogResult =
  | { canceled: true }
  | {
      canceled: false;
      filePath: string;
      fileName: string;
      bytes: Uint8Array;
      contentHash: string;
      sidecar?: ToolboxOpenImageDialogSidecar;
    };

interface ToolboxOpenImagesDialogFileMetadataEntry {
  fileName: string;
  filePath: string;
  fileSizeBytes: number;
  mtimeMs: number;
}

type ToolboxOpenImagesDialogResult =
  | { canceled: true }
  | { canceled: false; files: ReadonlyArray<ToolboxOpenImagesDialogFileMetadataEntry> };

interface ToolboxOpenedImagesFileSidecar {
  fileName: string;
  bytes: Uint8Array;
}

interface ToolboxOpenedImagesFileEntry {
  fileName: string;
  filePath: string;
  bytes: Uint8Array;
  contentHash: string;
  fileSizeBytes: number;
  mtimeMs: number;
  sidecar?: ToolboxOpenedImagesFileSidecar;
}

interface ToolboxSaveImageDialogFilter {
  name: string;
  extensions: ReadonlyArray<string>;
}

interface ToolboxSaveImageDialogSidecar {
  extension: string;
  bytes: Uint8Array;
}

interface ToolboxSaveImageDialogRequest {
  suggestedFileName: string;
  bytes: Uint8Array;
  fileFilter: ToolboxSaveImageDialogFilter;
  sidecar?: ToolboxSaveImageDialogSidecar;
}

type ToolboxSaveImageDialogResult =
  | { canceled: true }
  | { canceled: false; filePath: string };

interface ToolboxSaveBundleDraftRenderingState {
  normalizationEnabled: boolean;
  selectedBandIndex: number;
  lastAppliedOperationLabel: string | null;
}

type ToolboxSaveBundleDraftOperationHistoryParameterValue = number | string | boolean;

interface ToolboxSaveBundleDraftOperationHistoryEntry {
  actionId: string;
  actionLabel: string;
  appliedLabel: string;
  parameterValues: Readonly<
    Record<string, ToolboxSaveBundleDraftOperationHistoryParameterValue>
  >;
  timestampMs: number;
}

interface ToolboxSaveBundleDraftBakedAssetSidecar {
  extension: string;
  bytes: Uint8Array;
}

interface ToolboxSaveBundleDraftBakedAsset {
  kind: "baked";
  bytes: Uint8Array;
  extension: string;
  sidecar?: ToolboxSaveBundleDraftBakedAssetSidecar;
}

interface ToolboxSaveBundleDraftExternalAsset {
  kind: "external";
  absolutePath: string;
  extension: string;
}

type ToolboxSaveBundleDraftAsset =
  | ToolboxSaveBundleDraftBakedAsset
  | ToolboxSaveBundleDraftExternalAsset;

interface ToolboxSaveBundleDraftViewportEntry {
  index: number;
  fileName: string;
  asset: ToolboxSaveBundleDraftAsset;
  renderingState: ToolboxSaveBundleDraftRenderingState;
  operationHistory: ReadonlyArray<ToolboxSaveBundleDraftOperationHistoryEntry>;
  colorInterpretation?: "rgb";
}

interface ToolboxSaveBundleDraft {
  formatVersion: number;
  gridLayout: string;
  selectedViewportIndices: ReadonlyArray<number>;
  viewports: ReadonlyArray<ToolboxSaveBundleDraftViewportEntry>;
}

interface ToolboxSaveBundleDialogRequest {
  draft: ToolboxSaveBundleDraft;
  currentProjectFilePath: string | null;
  saveAs: boolean;
}

type ToolboxSaveBundleDialogResult =
  | { canceled: true }
  | { canceled: false; filePath: string };

type ToolboxOpenBundleDialogResult =
  | { canceled: true }
  | { canceled: false; projectFilePath: string; bytes: Uint8Array };

interface ToolboxReadBundleAssetRequest {
  projectFilePath: string;
  relativePath: string;
}

interface ToolboxReadBundleAssetSidecar {
  fileName: string;
  bytes: Uint8Array;
}

type ToolboxReadBundleAssetResult =
  | { kind: "missing"; relativePath: string }
  | {
      kind: "found";
      absolutePath: string;
      fileName: string;
      bytes: Uint8Array;
      sidecar?: ToolboxReadBundleAssetSidecar;
    };

type ToolboxThemeMode = "system" | "light" | "dark";

interface ToolboxThemeSnapshot {
  mode: ToolboxThemeMode;
  isDark: boolean;
}

interface ToolboxPythonEnvironmentSnapshot {
  ownInterpreterPath: string | null;
  pathExists: boolean;
}

type ToolboxRunUserScriptSource =
  | { mode: "formula"; expression: string }
  | { mode: "import" };

type ToolboxRunUserScriptResultKind = "value" | "cube";

// The assembled outcome of a chunked user-script run, produced by the renderer
// orchestrator (lib/python/run-user-script-chunked.ts), not by one IPC call.
type ToolboxRunUserScriptResult =
  | { status: "completed"; value: unknown; sourceName?: string }
  | { status: "completed-cube"; shape: number[]; bands: Float32Array[]; sourceName?: string }
  | { status: "canceled" }
  | { status: "failed"; message: string };

// CT-219g chunked user-script run protocol (mirrors
// src/shared/chunked-user-script-run-protocol.ts; keep in sync).
interface ToolboxUserScriptRunCubeDescriptor {
  bandCount: number;
  height: number;
  width: number;
  wavelengths: number[] | null;
}

interface ToolboxUserScriptRunBeginRequest {
  source: ToolboxRunUserScriptSource;
  resultKind: ToolboxRunUserScriptResultKind;
  cube: ToolboxUserScriptRunCubeDescriptor;
}

type ToolboxUserScriptRunBeginResult =
  | { status: "canceled" }
  | { status: "failed"; message: string }
  | { status: "ready"; token: string; sourceName: string | null };

interface ToolboxUserScriptRunCubeChunkRequest {
  token: string;
  bytes: Uint8Array;
}

interface ToolboxUserScriptRunExecuteRequest {
  token: string;
}

type ToolboxUserScriptRunExecuteResult =
  | { status: "completed"; value: unknown }
  | { status: "completed-cube"; shape: [number, number, number]; totalBytes: number }
  | { status: "failed"; message: string };

interface ToolboxUserScriptRunResultChunkRequest {
  token: string;
}

interface ToolboxUserScriptRunResultChunkResult {
  done: boolean;
  bytes: Uint8Array;
}

interface ToolboxUserScriptRunReleaseRequest {
  token: string;
}

type ToolboxMenuEventListener = () => void;
type ToolboxMenuCommandListener = (commandId: string) => void;
type ToolboxUnsubscribeMenuListener = () => void;
type ToolboxThemeChangeListener = (snapshot: ToolboxThemeSnapshot) => void;
type ToolboxUnsubscribeThemeListener = () => void;

type ToolboxPlatform =
  | "aix"
  | "android"
  | "darwin"
  | "freebsd"
  | "haiku"
  | "linux"
  | "openbsd"
  | "sunos"
  | "win32"
  | "cygwin"
  | "netbsd";

interface ToolboxApi {
  platform: ToolboxPlatform;
  versions: {
    electron: string;
    chrome: string;
    node: string;
  };
  getAppInfo: () => Promise<ToolboxAppInfo>;
  openImageDialog: () => Promise<ToolboxOpenImageDialogResult>;
  openImagesDialog: () => Promise<ToolboxOpenImagesDialogResult>;
  readOpenedImageFile: (
    metadata: ToolboxOpenImagesDialogFileMetadataEntry,
  ) => Promise<ToolboxOpenedImagesFileEntry>;
  saveImageDialog: (
    request: ToolboxSaveImageDialogRequest,
  ) => Promise<ToolboxSaveImageDialogResult>;
  openProjectBundleDialog: () => Promise<ToolboxOpenBundleDialogResult>;
  readProjectBundleAsset: (
    request: ToolboxReadBundleAssetRequest,
  ) => Promise<ToolboxReadBundleAssetResult>;
  saveProjectBundleDialog: (
    request: ToolboxSaveBundleDialogRequest,
  ) => Promise<ToolboxSaveBundleDialogResult>;
  onMenuOpenImage: (
    listener: ToolboxMenuEventListener,
  ) => ToolboxUnsubscribeMenuListener;
  onMenuSaveImage: (
    listener: ToolboxMenuEventListener,
  ) => ToolboxUnsubscribeMenuListener;
  onMenuOpenProject: (
    listener: ToolboxMenuEventListener,
  ) => ToolboxUnsubscribeMenuListener;
  onMenuSaveProject: (
    listener: ToolboxMenuEventListener,
  ) => ToolboxUnsubscribeMenuListener;
  onMenuSaveProjectAs: (
    listener: ToolboxMenuEventListener,
  ) => ToolboxUnsubscribeMenuListener;
  onMenuAbout: (
    listener: ToolboxMenuEventListener,
  ) => ToolboxUnsubscribeMenuListener;
  onMenuPythonEnvironment: (
    listener: ToolboxMenuEventListener,
  ) => ToolboxUnsubscribeMenuListener;
  onMenuInvokeCommand: (
    listener: ToolboxMenuCommandListener,
  ) => ToolboxUnsubscribeMenuListener;
  getPythonEnvironment: () => Promise<ToolboxPythonEnvironmentSnapshot>;
  setPythonEnvironment: (
    ownInterpreterPath: string | null,
  ) => Promise<ToolboxPythonEnvironmentSnapshot>;
  beginUserScriptRun: (
    request: ToolboxUserScriptRunBeginRequest,
  ) => Promise<ToolboxUserScriptRunBeginResult>;
  sendUserScriptRunCubeChunk: (
    request: ToolboxUserScriptRunCubeChunkRequest,
  ) => Promise<void>;
  executeUserScriptRun: (
    request: ToolboxUserScriptRunExecuteRequest,
  ) => Promise<ToolboxUserScriptRunExecuteResult>;
  readUserScriptRunResultChunk: (
    request: ToolboxUserScriptRunResultChunkRequest,
  ) => Promise<ToolboxUserScriptRunResultChunkResult>;
  releaseUserScriptRun: (
    request: ToolboxUserScriptRunReleaseRequest,
  ) => Promise<void>;
  initialTheme: ToolboxThemeSnapshot;
  onThemeChange: (
    listener: ToolboxThemeChangeListener,
  ) => ToolboxUnsubscribeThemeListener;
}

interface Window {
  toolboxApi: ToolboxApi;
}
