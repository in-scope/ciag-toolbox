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
  onMenuOpenImage: (
    listener: ToolboxMenuEventListener,
  ) => ToolboxUnsubscribeMenuListener;
  onMenuSaveImage: (
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
