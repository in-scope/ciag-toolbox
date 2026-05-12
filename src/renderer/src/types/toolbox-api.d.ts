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

interface ToolboxOpenImageStackDialogFileEntry {
  fileName: string;
  filePath: string;
  bytes: Uint8Array;
  contentHash: string;
  fileSizeBytes: number;
  mtimeMs: number;
}

type ToolboxOpenImageStackDialogResult =
  | { canceled: true }
  | { canceled: false; files: ReadonlyArray<ToolboxOpenImageStackDialogFileEntry> };

interface ToolboxOpenImageStackProgressEvent {
  fileIndex: number;
  totalCount: number;
  fileName: string;
}

type ToolboxOpenImageStackProgressListener = (
  event: ToolboxOpenImageStackProgressEvent,
) => void;
type ToolboxUnsubscribeOpenImageStackProgressListener = () => void;

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

type ToolboxMenuEventListener = () => void;
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
  openImageStackDialog: () => Promise<ToolboxOpenImageStackDialogResult>;
  onOpenImageStackProgress: (
    listener: ToolboxOpenImageStackProgressListener,
  ) => ToolboxUnsubscribeOpenImageStackProgressListener;
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
  onMenuOpenImageStack: (
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
  initialTheme: ToolboxThemeSnapshot;
  onThemeChange: (
    listener: ToolboxThemeChangeListener,
  ) => ToolboxUnsubscribeThemeListener;
}

interface Window {
  toolboxApi: ToolboxApi;
}
