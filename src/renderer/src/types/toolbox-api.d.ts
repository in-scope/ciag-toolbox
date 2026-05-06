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

interface ToolboxSaveProjectDraftViewportSource {
  absolutePath: string;
  contentHash: string;
  fileName: string;
}

interface ToolboxSaveProjectDraftRenderingState {
  normalizationEnabled: boolean;
  selectedBandIndex: number;
  lastAppliedOperationLabel: string | null;
}

interface ToolboxSaveProjectDraftViewportEntry {
  index: number;
  source: ToolboxSaveProjectDraftViewportSource;
  renderingState: ToolboxSaveProjectDraftRenderingState;
}

interface ToolboxSaveProjectDraft {
  formatVersion: number;
  gridLayout: string;
  selectedViewportIndices: ReadonlyArray<number>;
  viewports: ReadonlyArray<ToolboxSaveProjectDraftViewportEntry>;
}

interface ToolboxSaveProjectDialogRequest {
  draft: ToolboxSaveProjectDraft;
  currentProjectFilePath: string | null;
  saveAs: boolean;
}

type ToolboxSaveProjectDialogResult =
  | { canceled: true }
  | { canceled: false; filePath: string };

type ToolboxOpenProjectDialogResult =
  | { canceled: true }
  | { canceled: false; filePath: string; bytes: Uint8Array };

interface ToolboxResolveProjectSourceRequest {
  projectFilePath: string;
  relativePath: string;
}

interface ToolboxResolveProjectSourceSidecar {
  fileName: string;
  bytes: Uint8Array;
}

type ToolboxResolveProjectSourceResult =
  | { kind: "missing" }
  | {
      kind: "found";
      absolutePath: string;
      fileName: string;
      bytes: Uint8Array;
      contentHash: string;
      sidecar?: ToolboxResolveProjectSourceSidecar;
    };

interface ToolboxLocateMissingProjectSourceRequest {
  originalFileName: string;
  defaultDir: string | null;
}

type ToolboxLocateMissingProjectSourceResult =
  | { kind: "canceled" }
  | {
      kind: "picked";
      absolutePath: string;
      fileName: string;
      bytes: Uint8Array;
      contentHash: string;
      sidecar?: ToolboxResolveProjectSourceSidecar;
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
  saveImageDialog: (
    request: ToolboxSaveImageDialogRequest,
  ) => Promise<ToolboxSaveImageDialogResult>;
  openProjectDialog: () => Promise<ToolboxOpenProjectDialogResult>;
  saveProjectDialog: (
    request: ToolboxSaveProjectDialogRequest,
  ) => Promise<ToolboxSaveProjectDialogResult>;
  resolveProjectSource: (
    request: ToolboxResolveProjectSourceRequest,
  ) => Promise<ToolboxResolveProjectSourceResult>;
  locateMissingProjectSource: (
    request: ToolboxLocateMissingProjectSourceRequest,
  ) => Promise<ToolboxLocateMissingProjectSourceResult>;
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
  initialTheme: ToolboxThemeSnapshot;
  onThemeChange: (
    listener: ToolboxThemeChangeListener,
  ) => ToolboxUnsubscribeThemeListener;
}

interface Window {
  toolboxApi: ToolboxApi;
}
