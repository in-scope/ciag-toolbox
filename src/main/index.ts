import { app, BrowserWindow, shell } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { installApplicationMenu } from "./menu";
import {
  attachWindowStatePersistence,
  loadSavedWindowBounds,
  type WindowBounds,
} from "./window-state";
import { registerAppInfoIpcHandler } from "./app-info";
import {
  E2E_TEST_MODE_PRELOAD_ARGUMENT,
  isE2eTestModeEnabled,
  registerE2eDialogStubTestChannelsWhenEnabled,
} from "./e2e-dialog-stub";
import { registerOpenBundleDialogIpcHandlers } from "./open-bundle-dialog";
import { registerOpenImageDialogIpcHandler } from "./open-image-dialog";
import { registerOpenImagesDialogIpcHandlers } from "./open-images-dialog";
import { registerSaveBundleDialogIpcHandler } from "./save-bundle-dialog";
import { registerSaveImageDialogIpcHandler } from "./save-image-dialog";
import { initializeThemeControllerFromDisk } from "./theme-controller";
import { createSplashWindow, type SplashWindowHandle } from "./splash-window";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function buildPreloadScriptPath(): string {
  return join(__dirname, "../preload/index.js");
}

function buildRendererIndexHtmlPath(): string {
  return join(__dirname, "../renderer/index.html");
}

function isRunningInDevelopment(): boolean {
  return Boolean(process.env["ELECTRON_RENDERER_URL"]);
}

function resolveDevelopmentModeWindowIconPath(): string | undefined {
  if (!isRunningInDevelopment()) return undefined;
  return join(__dirname, "../../build/icon.ico");
}

function setWindowsAppUserModelIdForTaskbarGrouping(): void {
  if (process.platform !== "win32") return;
  app.setAppUserModelId("sh.inscope.ciag.toolbox");
}

function loadRendererIntoWindow(window: BrowserWindow): void {
  const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devServerUrl !== undefined) {
    void window.loadURL(devServerUrl);
    return;
  }
  void window.loadFile(buildRendererIndexHtmlPath());
}

function attachExternalLinkHandler(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
}

function buildBrowserWindowOptionsFrom(
  bounds: WindowBounds,
): Electron.BrowserWindowConstructorOptions {
  return {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    icon: resolveDevelopmentModeWindowIconPath(),
    show: false,
    autoHideMenuBar: false,
    webPreferences: {
      preload: buildPreloadScriptPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: buildPreloadAdditionalArguments(),
    },
  };
}

function buildPreloadAdditionalArguments(): string[] {
  return isE2eTestModeEnabled() ? [E2E_TEST_MODE_PRELOAD_ARGUMENT] : [];
}

function maximizeWindowIfPreviouslyMaximized(
  window: BrowserWindow,
  bounds: WindowBounds,
): void {
  if (bounds.isMaximized) window.maximize();
}

async function showMainWindowAfterSplashMinimumElapsed(
  mainWindow: BrowserWindow,
  splash: SplashWindowHandle | null,
): Promise<void> {
  if (splash !== null) await splash.waitUntilMinimumDisplayDurationElapsed();
  mainWindow.show();
  if (splash !== null) splash.dismiss();
}

function deferMainWindowShowUntilReadyAndSplashElapsed(
  mainWindow: BrowserWindow,
  splash: SplashWindowHandle | null,
): void {
  mainWindow.once("ready-to-show", () => {
    void showMainWindowAfterSplashMinimumElapsed(mainWindow, splash);
  });
}

function createMainWindow(splash: SplashWindowHandle | null): BrowserWindow {
  const savedBounds = loadSavedWindowBounds();
  const window = new BrowserWindow(buildBrowserWindowOptionsFrom(savedBounds));
  maximizeWindowIfPreviouslyMaximized(window, savedBounds);
  deferMainWindowShowUntilReadyAndSplashElapsed(window, splash);
  attachExternalLinkHandler(window);
  attachWindowStatePersistence(window);
  installApplicationMenu(window);
  loadRendererIntoWindow(window);
  if (isRunningInDevelopment()) {
    window.webContents.openDevTools({ mode: "detach" });
  }
  return window;
}

function reopenWindowOnMacActivate(): void {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow(null);
  }
}

function quitWhenAllWindowsClosed(): void {
  if (process.platform !== "darwin") {
    app.quit();
  }
}

app.whenReady().then(() => {
  setWindowsAppUserModelIdForTaskbarGrouping();
  initializeThemeControllerFromDisk();
  registerAppInfoIpcHandler();
  registerOpenImageDialogIpcHandler();
  registerOpenImagesDialogIpcHandlers();
  registerSaveImageDialogIpcHandler();
  registerOpenBundleDialogIpcHandlers();
  registerSaveBundleDialogIpcHandler();
  registerE2eDialogStubTestChannelsWhenEnabled();
  const splash = createSplashWindow();
  createMainWindow(splash);
  app.on("activate", reopenWindowOnMacActivate);
});

app.on("window-all-closed", quitWhenAllWindowsClosed);
