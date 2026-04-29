interface ToolboxAppInfo {
  name: string;
  version: string;
}

type ToolboxOpenImageDialogResult =
  | { canceled: true }
  | {
      canceled: false;
      filePath: string;
      fileName: string;
      bytes: Uint8Array;
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
  onMenuOpenImage: (
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
